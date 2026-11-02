"""Package only the new extension, excluding original CRX and investigation evidence."""
from pathlib import Path
import json
import zipfile
root = Path(__file__).resolve().parents[1]
source = root / 'extension'
version = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))['version']
output_dir = root / 'dist'
output_dir.mkdir(exist_ok=True)
output = output_dir / f'livebox-next-{version}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            package.write(file, file.relative_to(source).as_posix())
with zipfile.ZipFile(output) as package:
    assert package.testzip() is None
    assert 'manifest.json' in package.namelist()
print(output)
