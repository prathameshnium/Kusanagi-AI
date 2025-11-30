# launcher.py
# This script acts as a simple menu to choose which application to run.

import subprocess
import sys
import os

def get_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

def main():
    """
    Presents a choice to the user and runs the selected script.
    """
    print("Welcome to the Kusanagi AI Suite")
    print("Please choose an application to run:")
    print("1: Kusanagi (Local)")
    print("2: Orochimaru (Local Research Assistant)")

    choice = input("Enter the number of your choice: ")

    script_to_run = None
    if choice == '1':
        print("Starting Kusanagi (Local)...")
        script_to_run = get_path('Kusanagi_Local.py')
    elif choice == '2':
        print("Starting Orochimaru (Local Research Assistant)...")
        script_to_run = get_path('Orochimaru_Local_Research_Assistent.py')
    else:
        print("Invalid choice. Exiting.")
        return

    if script_to_run:
        try:
            # Execute the script using the Python interpreter bundled with the exe
            subprocess.run([sys.executable, script_to_run])
        except FileNotFoundError:
            print(f"Error: Could not find {os.path.basename(script_to_run)}.")
            print("Please ensure it is included in the bundled application.")
        except Exception as e:
            print(f"An error occurred while running the script: {e}")

if __name__ == "__main__":
    main()
