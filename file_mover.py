
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
    ai_models_dir = os.path.join(base_dir, 'AI-models')
    
    # Source directories
    tinyllama_dir = os.path.join(ai_models_dir, 'tinyllama')
    text_embedding_dir = os.path.join(base_dir, 'text_embedding_model')
    
    # Destination directories
    main_manifests_dir = os.path.join(ai_models_dir, 'manifests')
    main_blobs_dir = os.path.join(ai_models_dir, 'blobs')
    
    # Move tinyllama files
    tinyllama_manifests = os.path.join(tinyllama_dir, 'manifests')
    tinyllama_blobs = os.path.join(tinyllama_dir, 'blobs')
    if os.path.exists(tinyllama_manifests):
        move_contents(tinyllama_manifests, main_manifests_dir)
        print(f"Moved contents of {tinyllama_manifests} to {main_manifests_dir}")
    if os.path.exists(tinyllama_blobs):
        move_contents(tinyllama_blobs, main_blobs_dir)
        print(f"Moved contents of {tinyllama_blobs} to {main_blobs_dir}")
    
    # Move text_embedding_model files
    text_embedding_manifests = os.path.join(text_embedding_dir, 'manifests')
    text_embedding_blobs = os.path.join(text_embedding_dir, 'blobs')
    if os.path.exists(text_embedding_manifests):
        move_contents(text_embedding_manifests, main_manifests_dir)
        print(f"Moved contents of {text_embedding_manifests} to {main_manifests_dir}")
    if os.path.exists(text_embedding_blobs):
        move_contents(text_embedding_blobs, main_blobs_dir)
        print(f"Moved contents of {text_embedding_blobs} to {main_blobs_dir}")
        
    # Remove empty source directories
    if os.path.exists(tinyllama_dir):
        try:
            os.rmdir(os.path.join(tinyllama_dir, 'manifests'))
            os.rmdir(os.path.join(tinyllama_dir, 'blobs'))
            os.rmdir(tinyllama_dir)
            print(f"Removed empty directory: {tinyllama_dir}")
        except OSError as e:
            print(f"Error removing {tinyllama_dir}: {e}")

    if os.path.exists(text_embedding_dir):
        try:
            os.rmdir(os.path.join(text_embedding_dir, 'manifests'))
            os.rmdir(os.path.join(text_embedding_dir, 'blobs'))
            os.rmdir(text_embedding_dir)
            print(f"Removed empty directory: {text_embedding_dir}")
        except OSError as e:
            print(f"Error removing {text_embedding_dir}: {e}")

if __name__ == '__main__':
    main()
