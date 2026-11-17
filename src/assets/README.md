# Значок Матч-центра

Основа — новое пользовательское изображение футбольного и теннисного мячей с неоновым
свечением на тёмной закруглённой плитке (17.11.2026). Внешний белый фон удалён встроенным
image_gen; белые детали мячей и тёмный фон внутри плитки сохранены.

Мастер дополнительно отцентрирован по видимому alpha-контуру и увеличен без изменения
пропорций. Холст 1024×1024; поля видимой части (alpha > 16): слева/справа 34 px,
сверху/снизу 38/37 px. Это около 3–4% прозрачного поля с каждой стороны.

- `icon-source.png` — прозрачный центрированный мастер.
- `icon.png` — 512×512 для окон, уведомлений и трея Electron.
- `icon.ico` — кадры 16, 24, 32, 48, 64, 128, 256 px для Windows exe и установщика.

Пересоздать PNG/ICO: `npm run icon` (FFmpeg в PATH). Скрипт сохраняет alpha.

Нормализация результата image_gen через FFmpeg:

```text
crop=1149:1139:52:64,scale=962:962:force_original_aspect_ratio=decrease:flags=lanczos,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba
```

Запрос к встроенному image_gen:

> Use case: background-extraction. Edit target: the supplied icon image of a large football on the right and a neon-yellow tennis ball in the lower left, inside a dark rounded-square tile with warm golden rim lighting. Remove ONLY the exterior white/off-white background outside the dark rounded-square silhouette and replace it with genuine transparent alpha. Preserve the dark tile interior, both balls, white football panels, tennis seam, textures and warm glow exactly; do not redesign or add anything. Center the entire existing rounded-square tile optically and geometrically on a square transparent canvas, and enlarge it uniformly so its visible bounds occupy approximately 94% of the canvas width and height, leaving equal small transparent margins of about 3% on all four sides. Preserve the original composition and proportions within the tile, including the original close-up cropping of the balls by the tile. Do not crop the outer tile or add a new frame/shadow. Clean antialiased outer contour with no white fringe; all external corners genuinely transparent. Output a PNG suitable as the master for a Windows app icon.
