import os
import sys

def list_files(startpath):
    # Limit the output to a reasonable number of lines to avoid flooding
    line_limit = 1000
    line_count = 0

    # Exclude common large/unnecessary directories
    exclude_dirs = {'__pycache__', '.git', '.vscode', 'node_modules'}

    print(f"Directory tree for: {startpath}\n")
    for root, dirs, files in os.walk(startpath, topdown=True):
        dirs[:] = [d for d in dirs if d not in exclude_dirs] # filter directories
        
        if line_count >= line_limit:
            print("\n[... Output truncated ...]")
            break

        level = root.replace(startpath, '').count(os.sep)
        indent = ' ' * 4 * (level)
        
        print(f'{indent}{os.path.basename(root)}/')
        line_count += 1

        subindent = ' ' * 4 * (level + 1)
        for f in files:
            if line_count >= line_limit:
                break
            print(f'{subindent}{f}')
            line_count += 1

if __name__ == "__main__":
    # If a path is provided as an argument, use it.
    # Otherwise, default to the current working directory.
    if len(sys.argv) > 1:
        path_to_list = sys.argv[1]
    else:
        path_to_list = os.getcwd()

    if os.path.isdir(path_to_list):
        list_files(path_to_list)
    else:
        print(f"Error: Path is not a valid directory: {path_to_list}")
