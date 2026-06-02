import numpy as np
import scipy.stats as sstats
import copy
import torch

def prune(event_list, T=28800):
    """
    Prune and validate a single event list.
    """
    errors = []
    
    # Ensure event_list is a numpy array
    if not isinstance(event_list, np.ndarray):
        event_list = np.array(event_list)
    
    if event_list.size == 0:
        errors.append("Event list is invalid - no events in the list")
        return None, errors
    
    # Normalize time values
    event_list[:, 0] = event_list[:, 0] - np.min(event_list[:, 0])
    
    # Filter events based on photon energies between 500 and 7000
    valid_indices = np.where((event_list[:, 1] <= 7000) & (event_list[:, 1] >= 500))[0]
    event_list = event_list[valid_indices, :]
    
    if event_list.size == 0:
        errors.append("Event list is invalid - no valid events in the observed period")
        return None, errors
    

    
    # Get only events up to time T
    valid_indices = np.where(event_list[:, 0] <= T)[0]
    event_list = event_list[valid_indices, :]
    
    if event_list.shape[0] < 2:
        errors.append("Event list is invalid - not enough events in the observed period")
        return None, errors
    
    # Apply random shift to the event times
    shift = np.random.uniform(0, event_list[1, 0] - event_list[0, 0])
    event_list[:, 0] = event_list[:, 0] + shift
    temp_ind = np.where(event_list[:, 0] <= T)[0]
    event_list = event_list[temp_ind, :]
    
    return event_list, errors

def source_to_xray_tensors(events, stats: dict, max_events: int = 512):
    """
    Convert one observation's photon list into the five tensors required by
    ImprovedXrayProcessor.
    """
    # Make sure we're on a NumPy array
    events = np.array(sorted(events, key=lambda x: x[0]), dtype=np.float32)
    if len(events) == 0:
        raise ValueError("event_list is empty for source")

    # Raw arrays
    t = events[:, 0]
    E_eV = events[:, 1]
    E_keV = E_eV * 1e-3

    # 1) per-event matrix
    rel_t = (t - t[0]) / (t[-1] - t[0])
    dt = np.diff(t, prepend=t[0])
    log_dt = np.log1p(dt)

    logE = np.log10(E_eV + 1)
    logE_z = (logE - stats["logE_mean"]) / stats["logE_std"]

    E_q = sstats.rankdata(E_eV) / len(E_eV)  # within-obs quantile
    abs_t = (t - t[0]) * stats["abs_t_scale"]

    per_event = np.stack([rel_t, abs_t, log_dt, logE_z, E_q], axis=1)

    # pad / truncate
    valid_len = per_event.shape[0]
    event_mask = np.zeros(max_events, dtype=bool)
    event_mask[:min(valid_len, max_events)] = True

    if valid_len < max_events:
        pad = np.zeros((max_events - valid_len, 5), dtype=np.float32)
        per_event = np.vstack([per_event, pad])
    else:
        per_event = per_event[:max_events]

    per_event = per_event.astype(np.float32)

    # 2) meta token
    duration = t[-1] - t[0]  # seconds
    log_dur = np.log10(duration + 1)
    rate_ksec = (valid_len / duration) * 1e3  # events / ks

    soft = np.count_nonzero(E_keV < 2.0)
    hard = np.count_nonzero((E_keV >= 2.0) & (E_keV < 7.0))
    HR = (hard - soft) / (hard + soft) if (soft + hard) else 0.0

    meta_token = np.asarray([log_dur, rate_ksec, HR], dtype=np.float32)

    # 3) energy spectrum
    counts, _ = np.histogram(E_keV, bins=stats["spec_edges_keV"])
    counts = counts / (duration / 1_000.0)  # per ks
    spec_vec = np.log1p(counts).astype(np.float32)  # (64,)

    # 4) PSD vector
    tau = t - t[0]
    freq = np.asarray(stats["psd_freq_hz"], dtype=np.float32)  # Convert to numpy array
    freq = freq.reshape(-1, 1)  # Shape it as a column vector
    tau = tau.reshape(1, -1)   # Shape time as a row vector
    sin = np.sin(2 * np.pi * freq * tau)
    cos = np.cos(2 * np.pi * freq * tau)
    power = 2 / len(tau[0]) * (sin.sum(1) ** 2 + cos.sum(1) ** 2)
    psd_vec = np.log1p(power).astype(np.float32)  # (50,)

    return per_event, event_mask, meta_token, spec_vec, psd_vec

def generate_answer(model,
                   tokenizer,
                   event_list,
                   global_stats,
                   question,
                   *,
                   max_new_tokens: int = 500,
                   temperature: float = 0.8,
                   top_k: int = 40,
                   device: str | torch.device = "cuda"):
    """
    Run the multimodal Qwen-2.5 model on a single (question, photon-list) pair.
    Returns:
        tuple: (prompt, answer, processed_data)
            - prompt: The full prompt used for generation
            - answer: The generated answer
            - processed_data: Tuple of (per_event, event_mask, meta_token, spec_vec, psd_vec)
    """
    model.eval()
    device = torch.device(device)

    # 1) prompt
    sys_prompt = ("Below is an instruction that describes a task, paired with an input that "
                 "provides further context. When the special token xray appears, it "
                 "stands for a learned embedding that represents the X-ray event data of "
                 "the current Chandra source; use the information carried by that token in "
                 "your analysis. Write a response that appropriately completes the request. "
                 "Before answering, think carefully about the question and create a step-by-"
                 "step chain of thoughts to ensure a logical and accurate response.\n\n"
                 "### Instruction:\n"
                 "You are an astrophysics expert with deep knowledge of Chandra X-ray data. "
                 "Please answer the following question.\n\n")
    
    prompt = f"{sys_prompt}Source: <xray> Question: {question} Response:\n:"
    input_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(device)

    # 2) convert photon list → five tensors
    processed_data = source_to_xray_tensors(
        event_list,
        global_stats,
        max_events=model.xray_processor.max_events
    )
    per_event, evt_mask, meta, spec, psd = processed_data

    per_event = (torch.from_numpy(per_event)
                 .unsqueeze(0)
                 .to(device=device, dtype=model.dtype))
    evt_mask = torch.from_numpy(evt_mask).unsqueeze(0).to(device, dtype=model.dtype)
    meta = torch.from_numpy(meta).unsqueeze(0).to(device, dtype=model.dtype)
    spec = torch.from_numpy(spec).unsqueeze(0).to(device, dtype=model.dtype)
    psd = torch.from_numpy(psd).unsqueeze(0).to(device, dtype=model.dtype)

    # 3) autoregressive generation loop
    attn_mask_text = torch.ones_like(input_ids)
    generated_ids = input_ids.clone()
    past_key_values = None

    with torch.no_grad():
        for _ in range(max_new_tokens):
            first_step = past_key_values is None

            cur_inp = generated_ids if first_step else generated_ids[:, -1:]
            cur_amask = attn_mask_text if first_step else torch.ones(
                (1, 1), dtype=torch.long, device=device)

            # feed X-ray tensors only on the first forward pass
            out = model(
                input_ids=cur_inp,
                attention_mask=cur_amask,
                past_key_values=past_key_values,
                per_event=per_event if first_step else None,
                event_mask=evt_mask if first_step else None,
                spec=spec if first_step else None,
                psd=psd if first_step else None,
                meta=meta if first_step else None,
                use_cache=True,
                return_dict=True,
            )
            past_key_values = out.past_key_values

            # temperature + top-k sampling
            logits = out.logits[:, -1, :] / temperature
            vals, idx = torch.topk(logits, k=top_k, dim=-1)
            probs = torch.softmax(vals, dim=-1)
            next_tok = idx.gather(-1, torch.multinomial(probs, 1))

            generated_ids = torch.cat([generated_ids, next_tok], dim=1)
            attn_mask_text = torch.cat([attn_mask_text,
                                      torch.ones_like(next_tok)], dim=1)

            if next_tok.item() == tokenizer.eos_token_id:
                break

    # 4) strip the prompt and return answer
    full = tokenizer.decode(generated_ids[0], skip_special_tokens=True)
    answer = full[len(prompt):].strip()
    return prompt, answer, processed_data 