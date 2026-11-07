import * as THREE from 'three';

/** Small, deterministic local textures, shared by every repeated prop. */
export function createMaterials() {
  const textured = (base: string, pattern: 'rock' | 'dirt' | 'metal' | 'fabric') => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!;
    c.fillStyle = base;
    c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = i % 3 ? 'rgba(15,12,9,.035)' : 'rgba(255,243,211,.04)';
      c.fillRect(
        (i * 71) % 128,
        (i * 47 + Math.floor(i / 128) * 19) % 128,
        pattern === 'fabric' ? 1 : 2,
        pattern === 'metal' ? 8 : 2,
      );
    }
    if (pattern === 'rock')
      for (let y = 7; y < 128; y += 17) {
        c.strokeStyle = 'rgba(63,42,30,.08)';
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(44, y + 7);
        c.lineTo(86, y + 3);
        c.lineTo(128, y + 11);
        c.stroke();
      }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 2;
    return new THREE.MeshLambertMaterial({ map });
  };
  return {
    rock: textured('#9c7d5d', 'rock'),
    dirt: textured('#bfa77d', 'dirt'),
    concrete: textured('#c1b9a0', 'rock'),
    olive: textured('#636e50', 'metal'),
    sandbag: textured('#a99f78', 'fabric'),
    rust: textured('#975842', 'metal'),
    wood: textured('#8e7c58', 'fabric'),
    dark: new THREE.MeshLambertMaterial({ color: 0x303b37 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x365b62 }),
    paint: new THREE.MeshLambertMaterial({ color: 0xd8c48e }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffecc4 }),
    distant: new THREE.MeshBasicMaterial({ color: 0xa69b89 }),
  };
}
export type Palette = ReturnType<typeof createMaterials>;
