import os
import shutil

def move_contents(src_dir, dst_dir):
    if not os.path.exists(dst_dir):
        os.makedirs(dst_dir)
    for item in os.listdir(src_dir):
        s = os.path.join(src_dir, item)
        d = os.path.join(dst_dir, item)
        shutil.move(s, d)

def main():
    base_dir = r'f:\1_PROJECTS\Git_Repos\GitHub\Kusanagi-AI\Portable_AI_Assets'
    # The user specified the new model directory is 'models'
    ai_models_dir = os.path.join(base_dir, 'models')
    
    # Destination directories
    main_manifests_dir = os.path.join(ai_models_dir, 'manifests')
    main_blobs_dir = os.path.join(ai_models_dir, 'blobs')
    
    # Consolidate all subdirectories that look like model folders
    # (i.e., they are not 'manifests' or 'blobs')
    models_to_consolidate = []
    if os.path.exists(ai_models_dir):
        for item in os.listdir(ai_models_dir):
            item_path = os.path.join(ai_models_dir, item)
            if os.path.isdir(item_path) and item not in ['manifests', 'blobs']:
                models_to_consolidate.append(item_path)

    if not models_to_consolidate:
        print("No model subdirectories found to consolidate.")
        return

    print(f"Found model directories to consolidate: {models_to_consolidate}")

    for model_path in models_to_consolidate:
        model_name = os.path.basename(model_path)
        print(f"\n--- Consolidating '{model_name}' ---")
        manifests_path = os.path.join(model_path, 'manifests')
        blobs_path = os.path.join(model_path, 'blobs')
        
        if os.path.exists(manifests_path):
            print(f"Moving manifests from {manifests_path}...")
            move_contents(manifests_path, main_manifests_dir)
        else:
            print(f"No 'manifests' directory found for {model_name}")

        if os.path.exists(blobs_path):
            print(f"Moving blobs from {blobs_path}...")
            move_contents(blobs_path, main_blobs_dir)
        else:
            print(f"No 'blobs' directory found for {model_name}")
            
        # Remove empty source directories
        print(f"Cleaning up {model_path}...")
        try:
            if os.path.exists(manifests_path): os.rmdir(manifests_path)
            if os.path.exists(blobs_path): os.rmdir(blobs_path)
            if not os.listdir(model_path):
                os.rmdir(model_path)
                print(f"Removed empty directory: {model_path}")
            else:
                print(f"Could not remove {model_path} as it is not empty.")
        except OSError as e:
            print(f"Error during cleanup of {model_path}: {e}")

    print("\nConsolidation complete.")

if __name__ == '__main__':
    main()