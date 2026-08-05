import os

OUTPUT_FILE = "all_code.txt"
SCRIPT_NAME = "gather.py"
EXCLUDE_DIRS = {".git", "__pycache__", "venv", "env", "node_modules", ".next", "dist", "build", ".vscode", "coverage"}
EXCLUDE_EXTS = {".db", ".pyc", ".mp3", ".wav", ".tar.gz", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".ttf", ".woff", ".woff2", ".eot"}

def should_exclude_file(file):
    if file in (OUTPUT_FILE, SCRIPT_NAME):
        return True
    return any(file.endswith(ext) for ext in EXCLUDE_EXTS)

def generate_tree(dir_path, prefix=""):
    tree_str = ""
    try:
        items = sorted(os.listdir(dir_path))
    except PermissionError:
        return tree_str

    dirs = [d for d in items if os.path.isdir(os.path.join(dir_path, d)) and d not in EXCLUDE_DIRS]
    files = [f for f in items if os.path.isfile(os.path.join(dir_path, f)) and not should_exclude_file(f)]

    entries = dirs + files
    for i, entry in enumerate(entries):
        is_last = (i == len(entries) - 1)
        connector = "└── " if is_last else "├── "
        tree_str += f"{prefix}{connector}{entry}\n"

        if entry in dirs:
            extension = "    " if is_last else "│   "
            tree_str += generate_tree(os.path.join(dir_path, entry), prefix + extension)

    return tree_str

def gather_code():
    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        # Сначала пишем дерево
        out.write("--- FILE STRUCTURE ---\n")
        out.write(".\n")
        out.write(generate_tree("."))
        out.write("\n\n")

        # Затем пишем содержимое файлов
        for root, dirs, files in os.walk("."):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            dirs.sort()
            files.sort()

            for file in files:
                if should_exclude_file(file):
                    continue

                filepath = os.path.join(root, file)
                clean_path = os.path.relpath(filepath, ".")

                out.write(f"--- FILE: {clean_path} ---\n")
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        out.write(f.read())
                    out.write("\n")
                except Exception as e:
                    out.write(f"<Ошибка чтения файла: {e}>\n")
                out.write("-e\n\n")

    print(f"Готово! Структура и исходники собраны в файл {OUTPUT_FILE}")

if __name__ == "__main__":
    gather_code()
