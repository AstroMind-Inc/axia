# Fine-tuned model — evaluation

`xray_testsuite.py` provides `XrayQATestSuite`, the harness used to evaluate
the trained model against a ground-truth Q&A set:

- `XrayQATestSuite.load(path, api_key=...)` — load a JSON test set
- `suite.run(model, tokenizer)` — generate model answers
- `suite.evaluate_with_llm(...)` — score predictions with GPT-as-judge
- `suite.build_stats_report(path)` — PDF + CSV summary

A test-set construction recipe (catalog truth + question templates) lives in
`side_studies/bulk_eval/` for reference; the actual test data used in the
paper is too large to ship with the repo and will be released separately
on Zenodo.
