"""Full-timeline one-second contact sheets from the actual browser canvas captures."""
from pathlib import Path

from PIL import Image, ImageDraw

folder = Path('docs/football-visual-review')
for index in (0, 2, 4):
    frames = sorted(p for p in folder.glob(f'match-{index}-*.png') if p.stem.split('-')[-1].isdigit())
    for offset in range(0, len(frames), 30):
        sheet = Image.new('RGB', (1500, 1296), '#152532')
        draw = ImageDraw.Draw(sheet)
        for n, frame in enumerate(frames[offset:offset+30]):
            picture = Image.open(frame).convert('RGB').resize((300, 192))
            x, y = n % 5*300, n//5*216
            sheet.paste(picture, (x, y+24))
            draw.text((x+8, y+5), f'Match {index} / {int(frame.stem.split("-")[-1])}s', fill='white')
        target = folder/f'sheet-{index}-{offset//30}.jpg'
        sheet.save(target, quality=90)
        print(target)
