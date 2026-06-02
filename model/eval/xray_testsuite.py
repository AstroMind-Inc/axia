# !pip install orjson openai

# from testsuite.xray_testsuite import XrayQATestSuite
# xray_qa_suite.py  ───────────────────────────────────────────────────
import json, os, random, time, threading, orjson, openai
from typing import Any, Dict, List, Sequence, Tuple
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tqdm import tqdm


WRONG_TYPES_POOL = [
    "YSO", "QSO", "High Mass X-ray Binary", "Pulsar", "Galaxy", "AGN"
]


class XrayQATestSuite:
    """
    Minimal, transparent test-suite helper:
      • builds/returns ground-truth-augmented records
      • save()/load() write/read exactly that JSON array
    """

    # ───────────────────────────  INIT  ────────────────────────────
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        gt_system_prompt: str,
        judge_system_prompt: str,
        question_templates: Sequence[str],
        context_keys: Sequence[str],
        id_keys: Tuple[str, str] = ("obsid", "source_name"),
        timeout: int = 60,
        max_retries: int = 3,
        backoff_sec: float = 2.0,
    ):
        self.client            = openai.Client(api_key=api_key)
        self.model             = model
        self.gt_prompt         = gt_system_prompt
        self.judge_prompt      = judge_system_prompt
        self.templates         = list(question_templates)
        self.context_keys      = list(context_keys)
        self.id_keys           = id_keys
        self.timeout           = timeout
        self.max_retries       = max_retries
        self.backoff_sec       = backoff_sec

        self.data: List[Dict[str, Any]] = []          # will hold augmented list
        self._lock = threading.Lock()                 # for parallel writes

    # ─────────────────────  INTERNAL LLM CALL  ──────────────────────
    # ─────────────────────  INTERNAL LLM CALL  ──────────────────────
    def _call_llm(self, *, system_prompt: str, user_json: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a JSON-mode request and return the parsed dict.
        Automatically appends a tiny note containing the word “JSON” if
        neither the system prompt nor the user payload already contain it.
        """
        # Is “json” already present?
        needs_tag = ("json" not in system_prompt.lower()
                     and "json" not in json.dumps(user_json).lower())

        if needs_tag:
            system_prompt = f"{system_prompt}\n\n(Respond in valid JSON.)"

        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self.client.chat.completions.create(
                    model=self.model,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": json.dumps(user_json)},
                    ],
                    timeout=self.timeout,
                )
                return json.loads(resp.choices[0].message.content)

            except Exception:
                if attempt == self.max_retries:
                    raise
                time.sleep(self.backoff_sec * attempt)
    # ───────────────────  QUESTION RENDER & CONTEXT  ─────────────────
    def _render_question(self, template: str, rec: Dict[str, Any]) -> str:
        if "{source_type}" not in template:
            return template
        real = rec.get("source_type") or rec.get("meta", {}).get("source_type") or "source"
        real = str(real).strip() or "source"
        wrong = random.choice([t for t in WRONG_TYPES_POOL if t.lower() != real.lower()])
        return template.format(source_type=real, wrong_source_type=wrong)

    def _context_payload(self, rec: Dict[str, Any]) -> Dict[str, Any]:
        return {k: rec.get(k) for k in self.context_keys if k in rec and rec.get(k) is not None}

    # ───────────  PARALLEL GROUND-TRUTH BUILDER (PUBLIC)  ────────────
    def prepare_ground_truth_dataset_parallel(
        self,
        records: List[Dict[str, Any]],
        *,
        max_workers: int = 6,
    ) -> List[Dict[str, Any]]:

        def _worker(rec: Dict[str, Any]) -> Dict[str, Any]:
            if "ground_truth_qa" in rec:
                return rec

            ctx = self._context_payload(rec)
            qas = []

            for tmpl in self.templates:                       # ← changed
                prompt   = tmpl["prompt"]                     # ← changed
                category = tmpl["category"]                   # ← changed

                rendered = self._render_question(prompt, rec)
                reply    = self._call_llm(system_prompt=self.gt_prompt,
                                          user_json={**ctx, "question": rendered})

                qas.append({
                    "question":   rendered,
                    "category":   category,                   # ← new field
                    "answer":     reply.get("answer", ""),
                    "confidence": reply.get("confidence", ""),
                })

            new_rec = rec.copy()
            new_rec["ground_truth_qa"] = qas
            return new_rec

        out: List[Dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            for r in tqdm(pool.map(_worker, records),
                          total=len(records),
                          desc="Building ground-truth"):
                out.append(r)

        self.data = out
        return out
        
    # ────────────────────────  SAVE / LOAD  ─────────────────────────
    def save(self, path: str | Path) -> None:
        if not self.data:
            raise ValueError("Nothing to save – run prepare_ground_truth_dataset_parallel first.")
        Path(path).write_bytes(orjson.dumps(self.data))

    def load(self, path: str | Path) -> None:
        with open(path) as f:
            self.data = json.load(f)
        # self.data = orjson.loads(Path(path).read_bytes())

    # ─────────────────────  BATCH EVALUATION  ───────────────────────
    def _find_gt_answer(self, key: Tuple[Any, ...], question: str) -> str | None:
        for rec in self.data:
            if tuple(rec[k] for k in self.id_keys) == key:
                for qa in rec.get("ground_truth_qa", []):
                    if qa["question"] == question:
                        return qa["answer"]
                return None
        return None

    def evaluate_answers_batch(
        self,
        batch: List[Dict[str, Any]],
        *,
        max_workers: int = 6,
    ) -> List[Dict[str, Any]]:

        def _to_id(r): return r if isinstance(r, tuple) else tuple(r[k] for k in self.id_keys)

        def _worker(item: Dict[str, Any]) -> Dict[str, Any]:
            key       = _to_id(item["record"])
            question  = item["question"]
            candidate = item["candidate_answer"]

            gt_answer = self._find_gt_answer(key, question)
            if gt_answer is None:
                return {"id": key, "question": question, "evaluation": "MISSING_GT"}

            payload = {
                "question":            question,
                "ground_truth_answer": gt_answer,
                "candidate_answer":    candidate,
            }
            rep = self._call_llm(system_prompt=self.judge_prompt, user_json=payload)
            return {"id": key, "question": question,
                    "evaluation": rep.get("evaluation", "WRONG")}

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            return list(tqdm(pool.map(_worker, batch),
                             total=len(batch),
                             desc="Evaluating answers"))


    # ───────────────────────────  NEW:  GRADING  ───────────────────────────
    def _judge(self, question: str, ground: str, cand: str) -> str:
        """Return CORRECT | PARTIALLY_CORRECT | WRONG."""
        payload = {
            "question":            question,
            "ground_truth_answer": ground,
            "candidate_answer":    cand,
        }
        rep = self._call_llm(system_prompt=self.judge_prompt, user_json=payload)
        return rep.get("evaluation", "WRONG")

    def grade_candidates_inplace(self, *, max_workers: int = 6) -> None:
        """
        Finds every QA dict that already contains a "candidate_answer"
        and **adds/overwrites** an "evaluation" field in the same dict.
        Operates on self.data in place (thread-safe).
        """

        tasks: List[Tuple[int, int]] = []       # (rec_idx, qa_idx)

        for ri, rec in enumerate(self.data):
            for qi, qa in enumerate(rec.get("ground_truth_qa", [])):
                if "candidate_answer" in qa:
                    tasks.append((ri, qi))

        def _worker(pair):
            ri, qi = pair
            rec = self.data[ri]
            qa  = rec["ground_truth_qa"][qi]
            ev  = self._judge(
                question = qa["question"],
                ground   = qa["answer"],
                cand     = qa["candidate_answer"],
            )
            # thread-safe write
            with self._lock:
                qa["evaluation"] = ev

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            list(tqdm(pool.map(_worker, tasks),
                      total=len(tasks),
                      desc="Grading candidates"))
    # ─────────────────────  INTERNAL: CONFIG SNAPSHOT  ────────────────────
    def _config_dict(self) -> Dict[str, Any]:
        """Return every attribute needed to rebuild an identical suite
        (except the API key, which must be supplied at load time)."""
        return dict(
            model              = self.model,
            gt_system_prompt   = self.gt_prompt,
            judge_system_prompt= self.judge_prompt,
            question_templates = self.templates,
            context_keys       = self.context_keys,
            id_keys            = self.id_keys,
            timeout            = self.timeout,
            max_retries        = self.max_retries,
            backoff_sec        = self.backoff_sec,
        )
    # ────────────────────────────  SAVE / LOAD  ───────────────────────────
    # (identical to earlier simple version)
    # ─────────────────────────  SAVE  ──────────────────────────
    def save(self, path: str | Path) -> None:
        """Write {"config": …, "data": …} to <path> in orjson format."""
        if not self.data:
            raise ValueError("Nothing to save – build or load data first.")
        blob = {
            "config": self._config_dict(),
            "data":   self.data,
        }
        Path(path).write_bytes(orjson.dumps(blob))
    @classmethod
    def load(cls, path: str | Path, *, api_key: str) -> "XrayQATestSuite":
        """Re-instantiates the suite (including prompts & templates)."""
        with open(path) as f:
            blob = json.load(f)
        cfg  = blob["config"]

        # create a new instance with stored settings
        obj = cls(
            api_key             = api_key,         # fresh key for current user
            model               = cfg["model"],
            gt_system_prompt    = cfg["gt_system_prompt"],
            judge_system_prompt = cfg["judge_system_prompt"],
            question_templates  = cfg["question_templates"],
            context_keys        = cfg["context_keys"],
            id_keys             = tuple(cfg["id_keys"]),
            timeout             = cfg.get("timeout", 60),
            max_retries         = cfg.get("max_retries", 3),
            backoff_sec         = cfg.get("backoff_sec", 2.0),
        )
        obj.data = blob["data"]
        return obj
    # ──────────────────────────────  EXPORT  ──────────────────────────────
    def tocsv(self, path: str | Path, *, include_candidate: bool = True) -> None:
        """
        Write one CSV row per ground-truth question.

        Columns:
          • obsid, source_name
          • question, category, answer, confidence
          • (optional) candidate_answer, evaluation
          • every key under `meta` as its own column

        Parameters
        ----------
        path : str | Path
            Output filename.
        include_candidate : bool, default True
            If False, drop columns 'candidate_answer' and 'evaluation'.
        """
        import csv, itertools

        if not self.data:
            raise ValueError("self.data is empty – generate or load first.")

        # 1. gather all distinct meta keys so the header is complete
        meta_keys = sorted(
            {k for rec in self.data for k in rec.get("meta", {}).keys()}
        )

        core_cols = [
            "obsid", "source_name",
            "question", "category",
            "answer", "confidence","text_description","qra_items"
        ]
        cand_cols = ["candidate_answer", "evaluation"] if include_candidate else []

        header = core_cols + cand_cols + meta_keys

        with open(path, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=header)
            writer.writeheader()

            # 2. one row per QA
            for rec in self.data:
                base = {
                    "obsid":        rec.get("obsid"),
                    "source_name":  rec.get("source_name"),
                    "text_description": rec.get("text_description"),
                    "qra_items":rec.get("qra_items")
                    
                }
                # meta fields flattened
                meta = rec.get("meta", {})
                for k in meta_keys:
                    base[k] = meta.get(k)

                for qa in rec.get("ground_truth_qa", []):
                    row = base | {
                        "question":   qa["question"],
                        "category":   qa.get("category"),
                        "answer":     qa["answer"],
                        "confidence": qa["confidence"],
                    }
                    if include_candidate:
                        row["candidate_answer"] = qa.get("candidate_answer")
                        row["evaluation"]       = qa.get("evaluation")
                    writer.writerow(row)

    # ─────────────────────────────  REPORT  ──────────────────────────────

    def build_stats_report(
        self,
        out_path: str | Path = "xrayqa_report.pdf",
    ) -> None:
        """
        Create a 4-page PDF:
    
            ① STRICT 3-way   text (CORRECT / PARTIALLY / WRONG)
            ② STRICT 3-way   stacked-bar chart
            ③ RELAXED 2-way  text  (CORRECT≙CORRECT∨PARTIALLY  vs  WRONG)
            ④ RELAXED 2-way  stacked-bar chart
        """
        import pandas as pd, matplotlib.pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages
        from pathlib import Path
    
        if not self.data:
            raise ValueError("self.data is empty – build / load first.")
    
        # ── flatten ──────────────────────────────────────────────────────
        rows = []
        for rec in self.data:
            for qa in rec.get("ground_truth_qa", []):
                if "evaluation" in qa:
                    rows.append(
                        dict(
                            obsid      = rec["obsid"],
                            source_name= rec["source_name"],
                            question   = qa["question"],
                            category   = qa.get("category", "unknown"),
                            evaluation = qa["evaluation"].upper().strip(),
                        )
                    )
        if not rows:
            raise ValueError("No evaluated QA pairs – run grade_candidates_inplace()")
    
        df_raw = pd.DataFrame(rows)
    
        # ── helpers ──────────────────────────────────────────────────────
        col_3 = dict(CORRECT="#2ca02c", PARTIALLY_CORRECT="#ff7f0e", WRONG="#d62728")
        col_2 = dict(CORRECT="#4daf4a", WRONG="#d62728")
    
        def _fraction_table(series: pd.Series, labels: list[str]) -> pd.Series:
            return (
                series.value_counts(normalize=True)
                      .reindex(labels, fill_value=0.0)
                      .astype(float)
            )
    
        def _by_group(df: pd.DataFrame, key: str, labels: list[str]) -> pd.DataFrame:
            return (df.groupby(key)["evaluation"]
                      .value_counts(normalize=True)
                      .unstack(fill_value=0.0)
                      .reindex(columns=labels, fill_value=0.0))
    
        def _text_page(title: str, overall: pd.Series,
                       by_cat: pd.DataFrame, by_q: pd.DataFrame) -> plt.Figure:
            fig = plt.figure(figsize=(11, 8.5))
            ax  = fig.add_subplot(111);  ax.axis("off")
    
            def fmt(lbl, val): return f"{lbl:<18}: {val*100:5.1f}%"
            txt  = title + "\n\nOverall fractions:\n"
            txt += "\n".join(fmt(l, overall[l]) for l in overall.index)
    
            txt += "\n\nPer-category fractions:\n"
            for cat, row in by_cat.iterrows():
                row_s = "  ".join(f"{l}:{row[l]*100:4.1f}%" for l in overall.index)
                txt  += f"  • {cat:<15} {row_s}\n"
    
            txt += "\nPer-question fractions:\n"
            for q, row in by_q.iterrows():
                row_s = "  ".join(f"{l}:{row[l]*100:4.1f}%" for l in overall.index)
                txt  += f"  • {q[:60]:<60} {row_s}\n"
    
            ax.text(0.01, 0.99, txt, va="top", family="monospace", fontsize=9)
            return fig
    
        def _bar_page(title: str, by_cat: pd.DataFrame,
                      order: list[str], cmap: dict[str, str]) -> plt.Figure:
            fig, ax = plt.subplots(figsize=(11, 5))
            bottoms = pd.Series(0, index=by_cat.index, dtype=float)
            for lab in order:
                vals = by_cat[lab] * 100
                ax.bar(by_cat.index, vals, bottom=bottoms,
                       color=cmap[lab], label=lab, alpha=0.9)
                bottoms += vals
            ax.set_title(title, fontsize=12)
            ax.set_ylabel("fraction [%]");  ax.set_ylim(0, 100)
            ax.tick_params(axis="x", rotation=25, labelsize=9)
            ax.legend(loc="upper right", fontsize=8)
            fig.tight_layout()
            return fig
    
        # ── build pages ─────────────────────────────────────────────────
        pdf_path = Path(out_path).with_suffix(".pdf")
        with PdfPages(pdf_path) as pdf:
    
            # ----- 3-way STRICT ----------------------------------------
            labs3   = ["CORRECT", "PARTIALLY_CORRECT", "WRONG"]
            ov3     = _fraction_table(df_raw["evaluation"], labs3)
            cat3    = _by_group(df_raw, "category",  labs3)
            q3      = _by_group(df_raw, "question",   labs3)
    
            pdf.savefig(_text_page("X-ray QA   STRICT 3-way evaluation",
                                   ov3, cat3, q3))
            pdf.savefig(_bar_page("Accuracy by category  (3-way)",
                                  cat3, labs3, col_3))
    
            # ----- 2-way RELAXED ---------------------------------------
            df2          = df_raw.copy()
            df2.loc[df2.evaluation == "PARTIALLY_CORRECT", "evaluation"] = "CORRECT"
            labs2        = ["CORRECT", "WRONG"]
            ov2          = _fraction_table(df2["evaluation"], labs2)
            cat2         = _by_group(df2, "category", labs2)
            q2           = _by_group(df2, "question", labs2)
    
            pdf.savefig(_text_page("X-ray QA   RELAXED 2-way evaluation "
                                   "(CORRECT ≙ CORRECT ∨ PARTIALLY)",
                                   ov2, cat2, q2))
            pdf.savefig(_bar_page("Accuracy by category  (2-way)",
                                  cat2, labs2, col_2))
    
        print(f"Report written to {pdf_path}")