# build_executable.py
# This script uses PyInstaller to create a single executable file for the Kusanagi AI Suite.

# --- Prerequisites ---
# 1. Install PyInstaller:
#    pip install pyinstaller
#
# 2. (Optional but Recommended for smaller file size) Download UPX:
#    - Go to: https://upx.github.io/
#    - Download the appropriate version for your system.
#    - Extract the `upx.exe` file and place it in a known location.
#
# --- How to Run ---
# 1. Open a terminal or command prompt in the root directory of this project.
# 2. Run this script:
#    python local_apps/build_executable.py
#
# 3. The final executable will be located in the `dist` directory:
#    dist/Kusanagi_Suite.exe

import PyInstaller.__main__
import os

# Get the absolute path to the project's root directory
# This ensures that paths are correct regardless of where the script is run from.
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# --- PyInstaller Configuration ---

# The name for the final executable file
exe_name = 'Kusanagi_Suite'

# The main entry point for the application
entry_script = os.path.join(project_root, 'local_apps', 'launcher.py')

# List of data files and directories to be included in the executable.
# The format is a list of tuples: ('source_path', 'destination_in_bundle')
# On Windows, the path separator for the source must be ';'.
# The destination is relative to the bundle's root.
data_to_add = [
    # Add the main application scripts
    (os.path.join(project_root, 'local_apps', 'Kusanagi_Local.py'), '.'),
    (os.path.join(project_root, 'local_apps', 'Orochimaru_Local_Research_Assistent.py'), '.'),
    
    # Add the entire Portable_AI_Assets directory
    (os.path.join(project_root, 'Portable_AI_Assets'), 'Portable_AI_Assets')
]

# Path to the UPX executable (CHANGE THIS if you installed it elsewhere)
# If you do not have UPX, PyInstaller will proceed without it, but the exe will be larger.
upx_dir = os.path.join(project_root, 'build', 'upx') # Example path, adjust if necessary

# Construct the PyInstaller command
pyinstaller_args = [
    '--name=%s' % exe_name,
    '--onefile',        # Create a single executable file
    '--windowed',       # Prevents a console window from appearing for the main launcher
    '--clean',          # Clean PyInstaller cache and remove temporary files before building
]

# Add data files to the command
for source, destination in data_to_add:
    pyinstaller_args.append('--add-data=%s%s%s' % (source, os.pathsep, destination))

# Add UPX compression if the directory is valid
if os.path.exists(upx_dir):
    print(f"UPX directory found at '{upx_dir}'. Enabling compression.")
    pyinstaller_args.append('--upx-dir=%s' % upx_dir)
else:
    print(f"UPX directory not found at '{upx_dir}'. Proceeding without compression.")
    print("For a smaller executable, download UPX and update the 'upx_dir' variable in this script.")

# Add the entry script as the final argument
pyinstaller_args.append(entry_script)

# --- Execute PyInstaller ---
if __name__ == '__main__':
    print("Starting PyInstaller build process...")
    print(f"Project Root: {project_root}")
    print(f"Arguments: {' '.join(pyinstaller_args)}")
    
    try:
        PyInstaller.__main__.run(pyinstaller_args)
        print("\nBuild complete!")
        print(f"The executable can be found in: {os.path.join(project_root, 'dist')}")
    except Exception as e:
        print("\nAn error occurred during the build process.")
        print(e)
