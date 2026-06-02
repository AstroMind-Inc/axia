#!/usr/bin/env python3
"""
Script to remove pllm_meta_analyst_only key from comparison and embeddings files.
"""

import json

FILES_TO_PROCESS = [
    ("outputs/gpt-5.1/comparison_of_all_models.json", "outputs/gpt-5.1/comparison_without_meta.json"),
    ("outputs/gpt-5.1/embeddings_from_all.json", "outputs/gpt-5.1/embeddings_without_meta.json")
]

def process_file(input_file, output_file):
    print(f"\nProcessing {input_file}...")
    print(f"Loading...")
    with open(input_file, 'r') as f:
        data = json.load(f)
    
    print(f"  Loaded {len(data)} items")
    
    # Remove pllm_meta_analyst_only key from each item
    removed_count = 0
    for item in data:
        if "pllm_meta_analyst_only" in item:
            del item["pllm_meta_analyst_only"]
            removed_count += 1
    
    print(f"  Removed key from {removed_count} items")
    print(f"  Saving to {output_file}...")
    with open(output_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"  ✅ Done! Saved {len(data)} items")

def main():
    print("=" * 80)
    print("Removing pllm_meta_analyst_only key from files")
    print("=" * 80)
    
    for input_file, output_file in FILES_TO_PROCESS:
        try:
            process_file(input_file, output_file)
        except FileNotFoundError:
            print(f"  ⚠️  File not found: {input_file}, skipping...")
        except Exception as e:
            print(f"  ❌ Error processing {input_file}: {str(e)}")
    
    print("\n" + "=" * 80)
    print("All files processed!")
    print("=" * 80)

if __name__ == "__main__":
    main()

