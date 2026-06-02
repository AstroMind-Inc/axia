#!/usr/bin/env python
# coding: utf-8

# In[1]:


# !pip install sentence-transformers matplotlib pandas google-api-python-client google-auth google-auth-httplib2 google-auth-oauthlib peft bitsandbytes 'accelerate>=0.26.0'  'typing_extensions==4.5.0' 


# In[2]:


# !pip install peft
# !pip install -U bitsandbytes
# !pip install typing_extensions==4.5.0
# !pip install -U typing_extensions>=4.6.0True


# In[3]:


# import gdown
# # https://drive.google.com/file/d/14VGgAVm1qIVfkatC4zgU39PG2FyAxqSC/view?usp=sharing
# # Replace FILE_ID with your file's ID.
# url = "https://drive.google.com/uc?id=14VGgAVm1qIVfkatC4zgU39PG2FyAxqSC"
# output = "/workspace/qna_sequences_with_64_emb_all_latents.json"  # Change to desired filename and extension

# gdown.download(url, output, quiet=False)

# export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"
# accelerate launch deepseek_train.py
# In[4]:


from base_functions import (
Qwen2_5_XrayForConditionalGeneration, XRayQnADataset, collate_fn, generate_answer, save_test_results, plot_loss_curves,Qwen2_5_XrayConfig, source_to_xray_tensors
)
import json
import torch
from transformers import AutoTokenizer, BitsAndBytesConfig
from torch.utils.data import DataLoader
import random
import torch.nn.functional as F
import os
from datetime import datetime
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

from transformers import AutoConfig
from peft import LoraConfig, get_peft_model
import gc
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["TORCH_CUDA_SDPA_ALLOW_FLASH"] = "0"
# Add imports for distributed training
import torch.distributed as dist
from accelerate.utils import gather_object
from tqdm.auto import tqdm
# Eval testsuite lives in `model/eval/`. When training, add the repo root to PYTHONPATH
# so this import resolves (`export PYTHONPATH=<axia-root>:$PYTHONPATH`).
from model.eval.xray_testsuite import XrayQATestSuite  # noqa: E402
torch.backends.cuda.sdp_kernel_enable_flash         = False   # Flash‑Attention 2
torch.backends.cuda.sdp_kernel_enable_mem_efficient = False   # mem‑eff kernel
torch.backends.cuda.sdp_kernel_enable_math          = True    # safe fallback

# In[5]:


access_token_hf = os.environ.get("HF_TOKEN", "")
global_stats = {
          "logE_mean": 3.263709927970281,
          "logE_std": 0.26947376549240537,
          "abs_t_scale": 0.0001,
          "spec_edges_keV": [
            0.5, 0.6015625, 0.703125, 0.8046875, 0.90625, 1.0078125, 1.109375, 1.2109375, 1.3125, 1.4140625,
            1.515625, 1.6171875, 1.71875, 1.8203125, 1.921875, 2.0234375, 2.125, 2.2265625, 2.328125, 2.4296875,
            2.53125, 2.6328125, 2.734375, 2.8359375, 2.9375, 3.0390625, 3.140625, 3.2421875, 3.34375, 3.4453125,
            3.546875, 3.6484375, 3.75, 3.8515625, 3.953125, 4.0546875, 4.15625, 4.2578125, 4.359375, 4.4609375,
            4.5625, 4.6640625, 4.765625, 4.8671875, 4.96875, 5.0703125, 5.171875, 5.2734375, 5.375, 5.4765625,
            5.578125, 5.6796875, 5.78125, 5.8828125, 5.984375, 6.0859375, 6.1875, 6.2890625, 6.390625, 6.4921875,
            6.59375, 6.6953125, 6.796875, 6.8984375, 7.0
          ],
          "psd_freq_hz": [
            0.0001, 0.00011731288478870299, 0.000137623129374475, 0.0001614496632056857, 0.00018940125738823506,
            0.00022219207886821498, 0.0002606599374922931, 0.00030578769216063937, 0.0003587283630024446, 0.0004208345911934581,
            0.0004936931991177906, 0.0005791657338907159, 0.0006794360301348616, 0.0007970660072450482, 0.0009350611267692985,
            0.0010969471823508163, 0.0012868603842241368, 0.0015096530399363222, 0.0017710175314496499, 0.0020776317562572594,
            0.002437329748551585, 0.0028593018398391052, 0.003354329473131718, 0.0039350606702485205, 0.00461633319045421,
            0.00541555363718021, 0.006353142199055634, 0.007453054388440607, 0.0087433931079507, 0.010257126683353603,
            0.012032931208673938, 0.014116178725535541, 0.01656009648485491, 0.019427126910175896, 0.022790523009889763,
            0.026736220001334847, 0.03136503096702011, 0.03679522264228132, 0.043165537146086244, 0.050638736860612994,
            0.0594057630317454, 0.06969061434328139, 0.08175607011307301, 0.09591040433952058, 0.11251526214320108,
            0.13199489984776064, 0.15484702478536733, 0.18165551178519232, 0.21310532125289144, 0.25
          ]
        }

# In[6]:


# import torch.distributed as dist
# if torch.cuda.device_count() > 1:
#     # Initialize process group
#     if not dist.is_initialized():
#         dist.init_process_group(backend='nccl')


# In[7]:

# Get process rank for distributed training
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

# Function to print only on main process
def main_process_print(*args, **kwargs):
    if is_main_process():
        print(*args, **kwargs)

cache_directory = "/workspace/cache"

base_model_name = "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
tokenizer = AutoTokenizer.from_pretrained(base_model_name,cache_dir=cache_directory)

local_rank = int(os.environ.get("LOCAL_RANK", 0))
torch.cuda.set_device(local_rank)
device = torch.device("cuda", local_rank)


# quantization_config = BitsAndBytesConfig(
#     load_in_4bit=True,
#     bnb_4bit_compute_dtype=torch.float16,
#     bnb_4bit_quant_type="nf4",
#     bnb_4bit_use_double_quant=True
# )

AutoConfig.register("qwen2_5_xray", Qwen2_5_XrayConfig)
AutoModelForCausalLM.register(Qwen2_5_XrayConfig, Qwen2_5_XrayForConditionalGeneration)


# Clear cache before loading model
gc.collect()
torch.cuda.empty_cache()

# Load the model with custom from_pretrained
model = Qwen2_5_XrayForConditionalGeneration.from_pretrained(base_model_name, cache_dir=cache_directory,    torch_dtype=torch.float16,  # Use half precision (saves ~50% memory)
    low_cpu_mem_usage=True)      # Reduces peak memory during loading
    # device_map="auto"          # Automatically optimize memory usage)

# Check parameters after initialization
trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
total_params = sum(p.numel() for p in model.parameters())
main_process_print(f"After init: Number of trainable parameters: {trainable_params}")
main_process_print(f"After init: Number of total parameters: {total_params}")
main_process_print(f"After init: Percentage: {trainable_params*100.0/total_params:.2f}%")


# In[8]:


lora_config = LoraConfig(
    r=8,                        # LoRA rank 
    lora_alpha=32,             # scaling
    lora_dropout=0.1,
    bias="none",
    task_type="CAUSAL_LM",
    target_modules=["W_pack", "o_proj", "mlp.dense_h_to_4h", "mlp.dense_4h_to_h"],
    modules_to_save=["xray_processor"]
    # ^ adjust to match your actual Qwen layer names
)
model = get_peft_model(model, lora_config)


# In[9]:


trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
total_params = sum(p.numel() for p in model.parameters())
main_process_print(f"After init: Number of trainable parameters: {trainable_params}")
main_process_print(f"After init: Number of total parameters: {total_params}")
main_process_print(f"After init: Percentage: {trainable_params*100.0/total_params:.2f}%")


# In[10]:


for name, param in model.named_parameters():
    if "xray_processor" in name:
        param.requires_grad = True


# In[11]:


trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
total_params = sum(p.numel() for p in model.parameters())
main_process_print(f"After init: Number of trainable parameters: {trainable_params}")
main_process_print(f"After init: Number of total parameters: {total_params}")
main_process_print(f"After init: Percentage: {trainable_params*100.0/total_params:.2f}%")


# In[12]:


# model.gradient_checkpointing_enable()

model.to(device)


# In[13]:


tokenizer.add_tokens(["<xray>"])
model.resize_token_embeddings(len(tokenizer))
model.config.xray_token_id = tokenizer.convert_tokens_to_ids("<xray>")
for param in model.get_input_embeddings().parameters():
    param.requires_grad = False

trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
total_params = sum(p.numel() for p in model.parameters())
main_process_print(f"After resize and refreeze: Number of trainable parameters: {trainable_params}")
main_process_print(f"After resize and refreeze: Number of total parameters: {total_params}")
main_process_print(f"After resize and refreeze: Percentage: {trainable_params*100.0/total_params:.2f}%")


# In[14]:


tokenizer.encode("<xray>", return_tensors="pt")


# In[15]:


if is_main_process():
    print(model)


# In[16]:


if is_main_process():
    print("Model structure:")
    for name, module in model.named_modules():
        print(f"  {name}")


# In[17]:


# Load data
data_embeddings_path =  '/workspace/qna_creationv2/51k_with_st_v1/new_qna_51450_with_st_v1_shuffled.json'
with open(data_embeddings_path, "r") as f:
    data_embeddings_json_all = json.load(f)


    
# data_embeddings_json_all = data_embeddings_json_all[:14000]
# train_split = len(data_embeddings_json_all) * 18 // 20
# valid_split = len(data_embeddings_json_all) * 19 // 20
test_split = 500
valid_split = 1500
main_process_print("Test Samples:", [0, test_split])
main_process_print("Validation Samples:", [test_split, valid_split])
main_process_print("Training Samples:", [valid_split, len(data_embeddings_json_all)])




# In[18]:


# Build dataset & data loaders
dataset_train = XRayQnADataset(data_embeddings_json_all[valid_split:],
                               tokenizer, global_stats,
                               max_length=512)
dataset_valid = XRayQnADataset(data_embeddings_json_all[test_split:valid_split],
                               tokenizer, global_stats,
                               max_length=512)

# train_dataloader = DataLoader(dataset_train,
#                               batch_size=512,
#                               shuffle=True,
#                               collate_fn=lambda b: collate_fn(b, pad_token_id=tokenizer.pad_token_id),
#                               pin_memory=True,
#                               num_workers=8)
# valid_dataloader = DataLoader(dataset_valid,
#                               batch_size=512,
#                               shuffle=False,
#                               collate_fn=lambda b: collate_fn(b, pad_token_id=tokenizer.pad_token_id),
#                               pin_memory=True,
#                               num_workers=8)


# In[19]:


# len(train_dataloader)


# In[20]:


trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
total_params = sum(p.numel() for p in model.parameters())
main_process_print(f"Number of trainable parameters: {trainable_params}")
main_process_print(f"Number of total parameters: {total_params}")
main_process_print(f"Percentage: {trainable_params*100.0/total_params}")


# In[21]:


# idx = 78

# test_data = data_embeddings_json_all[idx]
# data_emb = torch.tensor(test_data['embedding'], dtype=torch.float)
# question = "What type of source is this?"
# prompt, answer = generate_answer(model, tokenizer, data_emb, question)
# print("\n=== Example Inference ===")
# print("Prompt:", prompt)
# print("Generated Answer:", answer)
# print("Actual:",  data_embeddings_json_all[idx]['source_type'])


# In[22]:

if is_main_process():
    print(f"=====================================\n")
    idx = 21
    test_data = data_embeddings_json_all[idx]
    data = source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)   
    question = "What type of source is this?"
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Prompt:", prompt)
    print("Generated Answer:", answer)
    print("Actual:",  data_embeddings_json_all[idx]['source_type'])

    
# Define training arguments
training_args = TrainingArguments(
    output_dir="./xray_finetune_results",
    per_device_train_batch_size=4,
    per_device_eval_batch_size=4,
    num_train_epochs=25,
    learning_rate=1e-4,
    logging_dir='./logs',
    logging_steps=10,          # Log training metrics every 100 steps
    eval_strategy='epoch', # Evaluate at the end of each epoch
    save_strategy='epoch',       # Save model at the end of each epoch (aligned with evaluation)
    save_total_limit=2,          # Keep only the last 2 checkpoints
    remove_unused_columns=False,
    fp16=True,                            # Enable mixed precision for efficiency (optional)
    # # Multi-GPU specific settings
    ddp_find_unused_parameters=True     # Optimize DDP for custom model
)

# Initialize Trainer
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=dataset_train,
    eval_dataset=dataset_valid,
    data_collator=lambda b: collate_fn(b, pad_token_id=tokenizer.pad_token_id),
)

# Start training
trainer.train(resume_from_checkpoint=True)
# trainer.train()


# In[ ]:

# Only plot loss curves on the main process
if is_main_process():
    plot_loss_curves(trainer, output_file="./xray_finetune_results/loss_curves.png")


# In[24]:

# Only run inference examples on the main process
if is_main_process():
    print(f"=====================================\n")
    idx = 21
    test_data = data_embeddings_json_all[idx]
    data = source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)  
    question = "What type of source is this?"
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Prompt:", prompt)
    print("Generated Answer:", answer)
    print("Actual:",  data_embeddings_json_all[idx]['source_type'])
    
    print(f"=====================================\n")
    idx = 23
    test_data = data_embeddings_json_all[idx]
    data =source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)  
    question = "What type of source is this?"
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Prompt:", prompt)
    print("Generated Answer:", answer)
    print("Actual:",  data_embeddings_json_all[idx]['source_type'])
    
    print(f"=====================================\n")
    idx = -15
    test_data = data_embeddings_json_all[idx]
    data = source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)  
    question = "What type of source is this?"
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Prompt:", prompt)
    print("Generated Answer:", answer)
    print("Actual:",  data_embeddings_json_all[idx]['source_type'])
    
    print(f"=====================================\n")
    idx = 4
    test_data = data_embeddings_json_all[idx]
    data = source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)  
    question = "What type of source is this?"
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Prompt:", prompt)
    print("Generated Answer:", answer)
    print("Actual:",  data_embeddings_json_all[idx]['source_type'])
    
    print(f"=====================================\n")
    idx = 99
    test_data = data_embeddings_json_all[idx]
    data = source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)  
    question = "What type of source is this?"
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Prompt:", prompt)
    print("Generated Answer:", answer)
    print("Actual:",  data_embeddings_json_all[idx]['source_type'])



# In[ ]:

# Only save test results on the main process
# if is_main_process():
#     print("Running Test cases")
#     test_data = data_embeddings_json_all[valid_split:valid_split+3]
#     df_test = save_test_results(test_data, model, tokenizer, global_stats, output_file="./xray_finetune_results/test_results.csv", device="cuda")


# # In[ ]:

# if is_main_process():
#     df_test


# In[ ]:


# In[ ]:
if is_main_process():
    OPENAI_API_KEY   = os.environ.get("OPENAI_API_KEY", "")
    
    data_embeddings_path = '/workspace/min_sig_5_pruned_raw_data.json'
    with open(data_embeddings_path, "r") as f:
        data_embeddings_json_all_test = json.load(f)    

        
    emb_lookup = {
        (int(e['obsid']), e['name']): e['event_list']
        for e in data_embeddings_json_all_test
    }    
    
    suite = XrayQATestSuite.load("./testsuite/gt_suite_test.json", api_key=OPENAI_API_KEY)
    gt_data = suite.data[:20]
    # gt_data = gt_data[:10]
    total_pairs = sum(len(rec["ground_truth_qa"]) for rec in gt_data)
    
    # ...
    with tqdm(total=total_pairs,
              desc="Generating answers",
              unit="pair") as pbar:
    
        for rec in gt_data:
            data_xray_event_list = emb_lookup.get((int(rec['obsid']), rec['source_name']))
            if data_xray_event_list is None:
                continue
            data_xray = source_to_xray_tensors(data_xray_event_list, global_stats, max_events = 512)  
            if data_xray is None:
                print(f"{rec['obsid']}, {rec['source_name']} not found")
                continue
            for qa in rec["ground_truth_qa"]:
                _, cand_answer = generate_answer(model, tokenizer, data_xray, qa['question'],  max_new_tokens=150, temperature=0.7)
                qa["candidate_answer"] = cand_answer
                pbar.update(1)
   
    suite.data = gt_data
    suite.grade_candidates_inplace(max_workers=3)
    suite.tocsv('./testsuite/evaluated_with_llm.csv')
    suite.save('./testsuite/evaluated_with_llm.json')
    suite.build_stats_report('./testsuite/evaluated_with_llm.pdf')     
# Only save and push the model on the main process
if is_main_process():
    print("Saving the model")
    # Save the fine-tuned model
    
    model.save_pretrained("./xray_finetune_results/final_model")
    tokenizer.save_pretrained("./xray_finetune_results/final_model")

    # Example usage of generate_answer
    test_data = data_embeddings_json_all[:test_split][0]  # Take first test sample
    data = source_to_xray_tensors(test_data['event_list'], global_stats, max_events = 512)  
    question = test_data['qna'][0]['question']
    prompt, answer = generate_answer(model, tokenizer, data, question)
    print("\n=== Example Inference ===")
    print("Question:", question)
    print("Generated Answer:", answer)


# In[ ]:

# Only push to hub on the main process
# if is_main_process():
#     print("Pushing to hub")
#     model.push_to_hub("a-imantha/qwen_2_5_xray_7b", use_temp_dir=True, use_auth_token=access_token_hf, repository_folder=".")
#     tokenizer.push_to_hub("a-imantha/qwen_2_5_xray_7b", use_temp_dir=True, use_auth_token=access_token_hf)
#     print("Pushing to hub completed...")