import torch
import torch.nn as nn
import json
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments, AutoConfig, Qwen2ForCausalLM, PretrainedConfig
from torch.utils.data import Dataset, DataLoader
from transformers.modeling_outputs import CausalLMOutputWithPast
import random
import matplotlib.pyplot as plt
from transformers import AutoConfig
import os
import torch.distributed as dist
# Custom processor for Xray embeddings
import numpy as np

from scipy import stats as sstats
# Helper function to check if this is the main process
def is_main_process():
    """Check if this is the main process (rank 0)"""
    # Check if using accelerate
    if 'LOCAL_RANK' in os.environ:
        return int(os.environ['LOCAL_RANK']) == 0
    # Check if using torch.distributed directly
    if dist.is_available() and dist.is_initialized():
        return dist.get_rank() == 0
    # Default to True if not in distributed setting
    return True


class XrayProcessor(nn.Module):
    def __init__(self,
                 hidden_size   : int,      # backbone embed dim
                 max_events    : int = 512,
                 d_model       : int = 256,
                 n_layers      : int = 6,
                 n_heads       : int = 8,
                 dropout       : float = 0.1):
        super().__init__()
        print(hidden_size)
        self.hidden_size = hidden_size
        # ─────────────────── 1) per-event tape ───────────────────
        self.event_proj = nn.Linear(5, d_model)
        self.pos_emb    = nn.Parameter(torch.randn(1, max_events, d_model) * 0.02)

        enc_layer = nn.TransformerEncoderLayer(
            d_model          = d_model,
            nhead            = n_heads,
            dim_feedforward  = d_model * 4,
            dropout          = dropout,
            activation       = "gelu",
            batch_first      = True,
        )
        self.encoder = nn.TransformerEncoder(enc_layer, n_layers)

        # ─────────────────── 2) side branches ────────────────────
        def side_mlp(in_dim):
            return nn.Sequential(
                nn.Linear(in_dim, d_model // 2),
                nn.GELU(),
                nn.LayerNorm(d_model // 2),
                nn.Linear(d_model // 2, d_model // 2),
                nn.GELU(),
                nn.LayerNorm(d_model // 2),
            )
        self.spec_mlp       = side_mlp(64)
        self.psd_mlp        = side_mlp(50)
        self.meta_fc        = nn.Sequential(
            nn.Linear(3, d_model // 2),
            nn.GELU(),
            nn.LayerNorm(d_model // 2),
        )

        # ─────────────────── 3) fusion & projector ───────────────
        concat_dim = d_model + 3 * (d_model // 2)
        self.fusion_ln = nn.LayerNorm(concat_dim)

        self.to_hidden = nn.Sequential(
            nn.Linear(concat_dim, hidden_size),
            nn.LayerNorm(hidden_size),
            nn.Dropout(dropout),
        )

    @torch.no_grad()
    def _make_src_key_padding_mask(self, event_mask):
        # event_mask: [B, T] bool → Transformer expects False=keep, True=pad
        return ~event_mask

    def forward(self,
                per_event,     # [B, T, 5]
                event_mask,    # [B, T]  bool (True for valid positions)
                meta_token,    # [B, 3]
                spec_vec,      # [B, 64]
                psd_vec        # [B, 50]
                ):
        B, T, _ = per_event.shape

        # 1) per-event tape → encoder pooled representation
        x = self.event_proj(per_event) + self.pos_emb[:, :T]
        key_pad = self._make_src_key_padding_mask(event_mask)
        tape_out = self.encoder(x, src_key_padding_mask=key_pad)
        pooled   = tape_out.masked_fill(key_pad.unsqueeze(-1), 0).sum(1) / event_mask.sum(1, keepdim=True)

        # 2) side branches
        spec_out   = self.spec_mlp(spec_vec)
        psd_out    = self.psd_mlp(psd_vec)
        meta_out   = self.meta_fc(meta_token)

        # 3) concat + project
        fused = torch.cat([pooled, spec_out, psd_out, meta_out], dim=-1)
        fused = self.fusion_ln(fused)
        return self.to_hidden(fused)      # [B, hidden_size]
        


# Define a custom configuration class for automap registration.
class Qwen2_5_XrayConfig(PretrainedConfig):
    model_type = "qwen2_5_xray"
    # You can add default or optional fields as you wish:
    def __init__(
        self,
        xray_token_id=None,
        hidden_size=None,
        architectures=None,
        auto_map=None,
        # ... other custom fields ...
        **kwargs
    ):
        """
        By taking **kwargs, we can handle arbitrary config fields 
        (like "vocab_size" or "num_attention_heads").
        We pass anything unrecognized through to PretrainedConfig.
        """
        super().__init__(**kwargs)
        self.xray_token_id = xray_token_id
        self.hidden_size = hidden_size
        self.architectures = architectures
        self.auto_map = auto_map
        # Optionally store or default any other fields from the base config:
        # e.g. self.num_attention_heads = kwargs.get("num_attention_heads", 32)
        # e.g. self.vocab_size        = kwargs.get("vocab_size", 30522)
        #
        # If the base Qwen config has many fields, you can store them similarly.

# Modified model class with a custom generate() method.
class Qwen2_5_XrayForConditionalGeneration(Qwen2ForCausalLM):
    config_class = Qwen2_5_XrayConfig  # tell HF to use our custom config
    model_type = "qwen2_5_xray"         # important for automapping

    def __init__(self, config):
        super().__init__(config)
        self.xray_processor = XrayProcessor(hidden_size=config.hidden_size)


    @classmethod
    def from_pretrained(cls, pretrained_model_name_or_path, *model_args,infer=False, **kwargs):
        # Load a config and set its model_type to our custom type.
        config = AutoConfig.from_pretrained(pretrained_model_name_or_path, *model_args, **kwargs)
        config.model_type = "qwen2_5_xray"  # override model_type so automap knows our model

        if infer:
            if "infer" in kwargs:
                del kwargs["infer"]
        
            # 3) If the parent also got a 'config=...' from somewhere, remove it so we only supply ours
            if "config" in kwargs:
                del kwargs["config"]
            kwargs["config"] = config
            
            model = super(Qwen2_5_XrayForConditionalGeneration, cls).from_pretrained(
                pretrained_model_name_or_path,
                *model_args,
                **kwargs
            )
        else:
            model = cls(config)
            pretrained_model = Qwen2ForCausalLM.from_pretrained(pretrained_model_name_or_path, *model_args, **kwargs)
    
            # When training, load state dict from base model
            model.load_state_dict(pretrained_model.state_dict(), strict=False)

        # Freeze all parameters by default:
        for param in model.parameters():
            param.requires_grad = False

        # Keep the xray_processor parameters trainable:
        for param in model.xray_processor.parameters():
            param.requires_grad = True

        return model

    def forward(
        self,
        input_ids=None,
        attention_mask=None,
        position_ids=None,
        past_key_values=None,
        inputs_embeds=None,
        labels=None,
        use_cache=None,
        output_attentions=None,
        output_hidden_states=None,
        return_dict=None,
        xray_payload=None,
        cache_position=None,
    ):
        return_dict = return_dict if return_dict is not None else self.config.use_return_dict
      
        if inputs_embeds is None:
            inputs_embeds = self.get_input_embeddings()(input_ids)
      
            if xray_payload is not None:
                fused = self.xray_processor(
                    xray_payload["per_event"],                # positional 'x'
                    event_mask   = xray_payload["event_mask"],
                    meta_token   = xray_payload["meta_token"],
                    spec_vec     = xray_payload["spec_vec"],
                    psd_vec      = xray_payload["psd_vec"],
                )
                mask  = (input_ids == self.config.xray_token_id).unsqueeze(-1)
                fused_exp = fused.unsqueeze(1).expand_as(inputs_embeds)
                inputs_embeds = torch.where(mask, fused_exp, inputs_embeds)
        outputs = super().forward(
            input_ids=None,
            attention_mask=attention_mask,
            position_ids=position_ids,
            past_key_values=past_key_values,
            inputs_embeds=inputs_embeds,
            labels=labels,
            use_cache=use_cache,
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )
        loss = None
        if labels is not None:
            shift_logits = outputs.logits[..., :-1, :].contiguous()
            shift_labels = labels[..., 1:].contiguous()
            loss_fct = nn.CrossEntropyLoss(ignore_index=-100)
            loss = loss_fct(shift_logits.view(-1, self.config.vocab_size), shift_labels.view(-1))
        if not return_dict:
            output = (outputs.logits,) + outputs[1:]
            return ((loss,) + output) if loss is not None else output
        return CausalLMOutputWithPast(
            loss=loss,
            logits=outputs.logits,
            past_key_values=outputs.past_key_values if use_cache else None,
            hidden_states=outputs.hidden_states,
            attentions=outputs.attentions,
        )
    def generate(
        self,
        input_ids,
        xray_embeddings=None,
        max_new_tokens=50,
        temperature=1.0,
        top_k=40,
        device=None,
        **generate_kwargs
    ):
        """
        A more robust generate() method that:
          - Respects initial prompt length
          - Handles xray_embeddings for <xray> tokens on the first step
          - Uses top-k sampling
          - Caches hidden states for efficient generation
        """
        self.eval()
        if device is None:
            # Attempt to infer device from input_ids if not explicitly set
            device = input_ids.device
    
        # Clone the prompt and build initial attention mask
        generated_ids = input_ids.clone().to(device)
        batch_size, prompt_len = generated_ids.shape
        attention_mask = torch.ones((batch_size, prompt_len), dtype=torch.long, device=device)
    
        # If user passed xray_embeddings, ensure they're on the right device/dtype
        # Typically xray_embeddings is [batch, embed_dim], so just check
        if xray_embeddings is not None:
            xray_embeddings = xray_embeddings.to(self.device, dtype=next(self.parameters()).dtype)
    
        # We'll maintain a running cache
        past_key_values = None
    
        with torch.no_grad():
            for step in range(max_new_tokens):
                # On the very first generation step, feed the entire prompt (and xray embeddings if provided).
                # On subsequent steps, only feed the last token (and no xray embeddings).
                if past_key_values is None:
                    current_input_ids = generated_ids
                    current_attention_mask = attention_mask
                    current_xray_embeddings = xray_embeddings
                else:
                    current_input_ids = generated_ids[:, -1:]  # just the newly generated token
                    # Expand attention mask by 1 on the right
                    current_attention_mask = torch.ones((batch_size, 1), dtype=torch.long, device=device)
                    current_xray_embeddings = None  # only inject xray on first step
    
                outputs = self(
                    input_ids=current_input_ids,
                    attention_mask=current_attention_mask,
                    past_key_values=past_key_values,
                    xray_payload=current_xray_embeddings,   # <- rename here
                    use_cache=True,
                    return_dict=True,
                )
                # Update cache
                past_key_values = outputs.past_key_values
    
                # Get the logits for the last token in the batch
                logits = outputs.logits[:, -1, :]  # shape: [batch_size, vocab_size]
                logits = logits / temperature       # apply temperature
    
                # ---- Top-k sampling ----
                # 1) Find the top_k largest logits
                topk_vals, topk_indices = torch.topk(logits, k=top_k, dim=-1)
                # 2) Convert them to probabilities
                probs = torch.softmax(topk_vals, dim=-1)
                # 3) Sample from that top-k distribution
                next_idx_in_topk = torch.multinomial(probs, num_samples=1)  # shape: [batch_size, 1]
                # 4) Map back to real token IDs
                next_token = topk_indices.gather(dim=-1, index=next_idx_in_topk)  # shape: [batch_size, 1]
    
                # Append sampled token to generated sequence
                generated_ids = torch.cat([generated_ids, next_token], dim=1)
                # Also grow the attention_mask by 1
                attention_mask = torch.cat(
                    [attention_mask, torch.ones((batch_size, 1), dtype=torch.long, device=device)], dim=1
                )
    
                # Optional: break on EOS
                if torch.any(next_token == self.config.eos_token_id):
                    # If *any* sample in the batch hits EOS, you might want to break or not.
                    # In single-sample mode, it's typical to break immediately.
                    # In multi-sample mode, you might want a more sophisticated approach.
                    break
    
        return generated_ids

def source_to_xray_tensors(events,
                           stats: dict,
                           max_events : int  = 512):
    """
    Convert one observation's photon list into the six tensors required by
    the ImprovedXrayProcessor.  Robust to 1-event or zero-duration edge cases.
    """
    # ──────────────────────────────────────────────────────────────
    EPS = 1e-8                                     # numerical floor
    events = np.asarray(sorted(events, key=lambda x: x[0]), dtype=np.float32)

    if events.size == 0:
        raise ValueError("event_list is empty for source")

    # raw columns
    t        = events[:, 0]
    E_eV     = events[:, 1]
    E_keV    = E_eV * 1e-3

    # ─── 1) per-event matrix --------------------------------------
    duration = max(t[-1] - t[0], EPS)              # avoid div-by-zero
    rel_t    = (t - t[0]) / duration
    dt       = np.diff(t, prepend=t[0])
    log_dt   = np.log1p(dt)

    logE     = np.log10(E_eV + 1.0)
    logE_z   = (logE - stats["logE_mean"]) / stats["logE_std"]

    E_q      = sstats.rankdata(E_eV) / len(E_eV)    # within-obs quantile
    abs_t    = (t - t[0]) * stats["abs_t_scale"]

    per_event = np.stack([rel_t, abs_t, log_dt, logE_z, E_q], axis=1)

    # pad / truncate to max_events
    valid_len  = len(per_event)
    event_mask = np.zeros(max_events, dtype=bool)
    event_mask[:min(valid_len, max_events)] = True

    if valid_len < max_events:                      # pad
        pad = np.zeros((max_events - valid_len, 5), dtype=np.float32)
        per_event = np.vstack([per_event, pad])
    else:                                           # truncate
        per_event = per_event[:max_events]

    per_event = per_event.astype(np.float32)

    # ─── 2) meta token -------------------------------------------
    log_dur    = np.log10(duration + 1.0)
    rate_ksec  = (valid_len / duration) * 1e3       # events per ks

    soft = np.count_nonzero(E_keV < 2.0)
    hard = np.count_nonzero((E_keV >= 2.0) & (E_keV < 7.0))
    HR   = (hard - soft) / (hard + soft) if (soft + hard) else 0.0

    meta_token = np.asarray([log_dur, rate_ksec, HR], dtype=np.float32)

    # ─── 3) energy spectrum --------------------------------------
    spec_edges = np.asarray(stats["spec_edges_keV"], dtype=np.float32)
    counts, _  = np.histogram(E_keV, bins=spec_edges)
    counts     = counts / (duration / 1_000.0)      # per ks
    spec_vec   = np.log1p(counts).astype(np.float32)  # (64,)

    # ─── 4) PSD vector -------------------------------------------
    freq  = np.asarray(stats["psd_freq_hz"], dtype=np.float32)  # (50,)
    tau   = t - t[0]
    # shape: 50×N  ⟹  broadcast multiplication works
    sin   = np.sin(2 * np.pi * freq[:, None] * tau)
    cos   = np.cos(2 * np.pi * freq[:, None] * tau)
    power = 2.0 / len(tau) * (sin.sum(1) ** 2 + cos.sum(1) ** 2)
    psd_vec = np.log1p(power).astype(np.float32)     # (50,)

    xray = {
        'per_event': per_event.tolist(),
        'event_mask': event_mask.tolist(),
        'meta_token': meta_token.tolist(),
        'spec_vec': spec_vec.tolist(),
        'psd_vec': psd_vec.tolist(), 
    }
    return xray
    
# Dataset class with <xray> token added to prompt
class XRayQnADataset(Dataset):
    def __init__(self, data_json_list, tokenizer, global_stats, max_length=750):
        self.data = []
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.eos_token = tokenizer.eos_token

        for d in data_json_list:
            
            emb = source_to_xray_tensors(d['event_list'], global_stats, max_events = 512)                                      # ← CHANGED
            qna_list = d['qna']
            extended_qna = d.get('extended_qna', [])

            # Shuffle and partition 'qna'
            shuffled_qna = qna_list.copy()
            random.shuffle(shuffled_qna)
            # idx = 0
            # while idx < len(shuffled_qna):
            #     remaining = len(shuffled_qna) - idx
            #     if remaining == 0:
            #         break
            #     seq_len = min((idx % 4) + 1, remaining)
            #     sequence = shuffled_qna[idx:idx + seq_len]
            #     self._add_sequence_to_data(emb, sequence)
            #     idx += seq_len
            for item in shuffled_qna:
                self._add_sequence_to_data(emb, [item])
            # Include 'extended_qna'
            for sequence in extended_qna:
                self._add_sequence_to_data(emb, sequence)

    def _add_sequence_to_data(self, emb, sequence):
        input_ids = []
        labels = []

        # Add the system prompt at the beginning of the sequence
        system_prompt = "System: You are an astrophysics expert with the knowledge of the specific xray source from chandra space observatory you are questioned on. Provide your detailed answer.\n"
        system_tokens = self.tokenizer(system_prompt, add_special_tokens=False, return_tensors="pt")["input_ids"].squeeze(0)
        input_ids.extend(system_tokens)
        labels.extend([-100] * len(system_tokens))  # Mask system prompt in labels

        # Loop through each question-answer pair
        for qa in sequence:
            question = qa['question']
            answer = qa['answer']

            # Tokenize the prompt part
            prompt_str = f"Question: {question} The source I am referring is <xray> \nAnswer:"
            prompt_tokens = self.tokenizer(prompt_str, add_special_tokens=False, return_tensors="pt")["input_ids"].squeeze(0)

            # Tokenize the answer part with EOS token
            answer_str = f" {answer} {self.eos_token} "
            answer_tokens = self.tokenizer(answer_str, add_special_tokens=False, return_tensors="pt")["input_ids"].squeeze(0)

            # Append prompt tokens to input_ids and mask them in labels
            input_ids.extend(prompt_tokens)
            labels.extend([-100] * len(prompt_tokens))

            # Append answer tokens to input_ids and preserve them in labels
            input_ids.extend(answer_tokens)
            labels.extend(answer_tokens)

        # Truncate if the sequence exceeds max_length
        if len(input_ids) > self.max_length:
            input_ids = input_ids[:self.max_length]
            labels = labels[:self.max_length]

        # Convert to tensors
        input_ids = torch.tensor(input_ids)
        attention_mask = torch.ones_like(input_ids)  # All tokens are attended to
        labels = torch.tensor(labels)

        # Store the processed sequence
        self.data.append((emb, input_ids, attention_mask, labels))

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        emb, input_ids, attention_mask, labels = self.data[idx]
        # convert every array inside the xray blob to tensors here
        emb_tensors = {
            "per_event": torch.tensor(emb["per_event"], dtype=torch.float32),
            "event_mask": torch.tensor(emb["event_mask"], dtype=torch.bool),
            "meta_token": torch.tensor(emb["meta_token"], dtype=torch.float32),
            "spec_vec": torch.tensor(emb["spec_vec"], dtype=torch.float32),
            "psd_vec": torch.tensor(emb["psd_vec"], dtype=torch.float32),
        }
        return {
            "embedding": emb_tensors,                          # ← type changed only
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "labels": labels
        }

# Collate function
def collate_fn(batch, pad_token_id=0):
    input_ids = [x["input_ids"] for x in batch]
    attention_masks = [x["attention_mask"] for x in batch]
    labels = [x["labels"] for x in batch]
    embs = [x["embedding"] for x in batch]

    max_len = max(len(ids) for ids in input_ids)

    input_ids_padded, attn_padded, labels_padded = [], [], []
    for i_ids, a_mask, labs in zip(input_ids, attention_masks, labels):
        pad_len = max_len - len(i_ids)
        input_ids_padded.append(
            torch.cat([i_ids, torch.full((pad_len,), pad_token_id, dtype=torch.long)])
        )
        attn_padded.append(
            torch.cat([a_mask, torch.zeros(pad_len, dtype=torch.long)])
        )
        labels_padded.append(
            torch.cat([labs, torch.full((pad_len,), -100, dtype=torch.long)])
        )

    input_ids_batch = torch.stack(input_ids_padded)
    attn_mask_batch = torch.stack(attn_padded)
    labels_batch = torch.stack(labels_padded)

    # collate xray tensors (keep variable names the same)
    keys = ["per_event", "event_mask", "meta_token", "spec_vec", "psd_vec"]
    max_T = max(e["per_event"].shape[0] for e in embs)

    def pad_evt(t, fill):
        pad_size = max_T - t.shape[0]
        return torch.cat([t, t.new_full((pad_size, *t.shape[1:]), fill)], dim=0)

    xray_batch = {k: [] for k in keys}
    for e in embs:
        xray_batch["per_event"].append(pad_evt(e["per_event"], 0.0))
        xray_batch["event_mask"].append(pad_evt(e["event_mask"], False))
        xray_batch["meta_token"].append(e["meta_token"])
        xray_batch["spec_vec"].append(e["spec_vec"])
        xray_batch["psd_vec"].append(e["psd_vec"])

    for k in keys:
        xray_batch[k] = torch.stack(xray_batch[k])

    # We don't move to device here - let DDP handle that
    return {
        "input_ids": input_ids_batch,
        "attention_mask": attn_mask_batch,
        "labels": labels_batch,
        "xray_payload": xray_batch          # <- change key
    }

# Updated generate_answer with corrected attention mask handling
def generate_answer(model,
                    tokenizer,
                    xray_data,                    # ← now the full "xray" dict
                    question,
                    max_new_tokens=150,
                    device="cuda",
                    temperature=0.7):
    """
    Fixed version that properly handles xray embeddings throughout generation
    """
    model.eval()
    system_prompt = "System: You are an astrophysics expert with the knowledge of the specific xray source from chandra space observatory you are questioned on. Provide your detailed answer.\n"
    prompt = f"{system_prompt}Question: {question} The source I am referring is <xray> \nAnswer:"
    input_ids = tokenizer.encode(prompt, return_tensors="pt").to(device)

    # ── build a batch-size-1 tensor bundle from the dict ────────────────
    xray_batch = {}
    for k, v in xray_data.items():
        t = torch.tensor(v)
        if k == "event_mask":
            t = t.bool()
        if t.dim() == 1:
            t = t.unsqueeze(0)          # [D]   → [1, D]
        elif t.dim() == 2:
            t = t.unsqueeze(0)          # [T,D] → [1,T,D]
        xray_batch[k] = t.to(device=model.device,
                              dtype=next(model.parameters()).dtype
                              if t.dtype.is_floating_point else t.dtype)

    generated_ids = input_ids.clone()

    with torch.no_grad():
        for step in range(max_new_tokens):
            if step == 0:
                # First step: process the full prompt with xray embeddings
                current_input_ids = generated_ids
                current_xray_embeddings = xray_batch
            else:
                # Subsequent steps: use the full sequence but no xray embeddings
                # This ensures the model can see the full context
                current_input_ids = generated_ids
                current_xray_embeddings = xray_batch
            
            current_attention_mask = torch.ones_like(current_input_ids, dtype=torch.long, device=device)
            
            outputs = model(
                input_ids=current_input_ids,
                attention_mask=current_attention_mask,
                past_key_values=None,  # Don't use cache to avoid context issues
                xray_payload=current_xray_embeddings,
                use_cache=True,  # Disable cache to avoid context issues
                return_dict=True,
            )
            
            # Get logits for the last position
            logits = outputs.logits[:, -1, :] / temperature

            # Check for problematic values
            if torch.isnan(logits).any() or torch.isinf(logits).any():
                print(f"Warning: NaN or Inf in logits at step {step}")
                break

            # Top-k sampling
            top_k = min(40, logits.size(-1))
            vals, idx = torch.topk(logits, k=top_k, dim=-1)
            probs = torch.softmax(vals, dim=-1)
            next_idx = torch.multinomial(probs, num_samples=1)
            next_token = idx.gather(dim=-1, index=next_idx)

            # Append the new token
            generated_ids = torch.cat([generated_ids, next_token], dim=1)

            # Stop if EOS token is generated
            if next_token.item() == tokenizer.eos_token_id:
                break

    full_output = tokenizer.decode(generated_ids[0], skip_special_tokens=True)
    answer = full_output[len(prompt):].strip()
    return prompt, answer

def plot_loss_curves(trainer, output_file="loss_curves.png"):
    """
    Plots training and validation loss curves from the Trainer's log history and saves the plot.
    """
    # Only run on main process
    if not is_main_process():
        return
        
    # Extract log history
    log_history = trainer.state.log_history
    
    # Create dictionaries to store losses by epoch
    train_losses_by_epoch = {}
    eval_losses = {}
    
    # Extract training losses and group by epoch
    for log in log_history:
        if "loss" in log and "epoch" in log:  # Training loss
            epoch = log["epoch"]
            loss = log["loss"]
            if epoch not in train_losses_by_epoch:
                train_losses_by_epoch[epoch] = []
            train_losses_by_epoch[epoch].append(loss)
        
        if "eval_loss" in log:  # Validation loss
            epoch = log["epoch"]
            eval_losses[epoch] = log["eval_loss"]
    
    # Calculate average training loss per epoch
    train_epochs = sorted(train_losses_by_epoch.keys())
    train_avg_losses = [sum(train_losses_by_epoch[e])/len(train_losses_by_epoch[e]) for e in train_epochs]
    
    # Get validation epochs and losses
    eval_epochs = sorted(eval_losses.keys())
    eval_loss_values = [eval_losses[e] for e in eval_epochs]
    
    # Plotting
    plt.figure(figsize=(10, 6))
    
    # Training loss (epoch-wise average)
    plt.plot(train_epochs, train_avg_losses, label="Training Loss (Epoch Avg)", color="blue", marker='.')
    
    # Validation loss (epoch-wise)
    plt.plot(eval_epochs, eval_loss_values, label="Validation Loss", color="orange", marker='o')
    
    plt.xlabel("Epochs")
    plt.ylabel("Loss")
    plt.title("Training and Validation Loss Curves")
    plt.legend()
    plt.grid(True)
    
    # Add minor ticks for better readability
    plt.minorticks_on()
    plt.grid(which='minor', linestyle=':', alpha=0.2)
    
    # Save the plot
    plt.savefig(output_file)
    plt.show()
    if is_main_process():
        print(f"Loss curves saved to {output_file}")

import pandas as pd
from sentence_transformers import SentenceTransformer, util

def create_qna_table(data_list, model, tokenizer, global_stats, device="cuda"):
    """
    Creates a table (as a pandas DataFrame) where each row corresponds to one Q/A pair.
    Columns: obsid, source_name, source_type, text_trained_with, question, actual_answer, model_answer.
    Only items with is_garbage == False (or missing) are included.
    Uses generate_answer for model predictions.
    """
    rows = []
    model.eval()
    with torch.no_grad():
        for item in data_list:
            if item.get("is_garbage", False):
                continue

            obsid = item.get("obsid", "")
            source_name = item.get("source_name", "")
            source_type = item.get("source_type", "")
            text_trained_with = item.get("answer", "")
            data = source_to_xray_tensors(item.get("event_list"), global_stats, max_events = 512)  
            qna_list = item.get("qna", [])

            for qa in qna_list:
                question = qa.get("question", "")
                actual_answer = qa.get("answer", "")
                _, model_answer = generate_answer(model, tokenizer, data, question, device=device)
                rows.append({
                    "obsid": obsid,
                    "source_name": source_name,
                    "source_type": source_type,
                    "text_trained_with": text_trained_with,
                    "question": question,
                    "actual_answer": actual_answer,
                    "model_answer": model_answer
                })

    return pd.DataFrame(rows, columns=["obsid", "source_name", "source_type", "text_trained_with", "question", "actual_answer", "model_answer"])

def add_semantic_similarity_column(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds a 'similarity' column with cosine similarity between 'actual_answer' and 'model_answer' embeddings.
    """
    embedder = SentenceTransformer('all-MiniLM-L6-v2')
    similarities = []
    for idx, row in df.iterrows():
        emb_actual = embedder.encode(row['actual_answer'], convert_to_tensor=True)
        emb_model = embedder.encode(row['model_answer'], convert_to_tensor=True)
        sim_score = util.cos_sim(emb_actual, emb_model).item()
        similarities.append(sim_score)
    df['similarity'] = similarities
    return df

def save_test_results(data_list, model, tokenizer, global_stats, output_file="test_results.csv", device="cuda"):
    """
    Generates a test file with Q/A pairs and similarity scores, then saves it to disk.
    """
    df_test = create_qna_table(data_list, model, tokenizer, global_stats, device=device)
    df_test = add_semantic_similarity_column(df_test)
    
    # Only save on main process
    if is_main_process():
        df_test.to_csv(output_file, index=False)
        print(f"Test results saved to {output_file}")
        
    return df_test