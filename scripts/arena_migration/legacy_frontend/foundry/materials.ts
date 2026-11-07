import * as THREE from 'three';

/** Eight local canvas materials, reused by all zones. No downloaded assets. */
export function materials() {
  const texture = (base: string, kind: 'metal' | 'concrete' | 'wood' | 'warning') => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      const x = (i * 73) % 256,
        y = (i * 151 + Math.floor(i / 256) * 29) % 256;
      c.fillStyle = i % 2 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)';
      c.fillRect(x, y, kind === 'wood' ? 1 : 2, kind === 'wood' ? 24 : 2);
    }
    if (kind === 'metal') {
      c.strokeStyle = 'rgba(0,0,0,.18)';
      c.lineWidth = 2;
      for (let x = 0; x < 256; x += 32) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, 256);
        c.stroke();
      }
      for (let y = 16; y < 256; y += 64)
        for (let x = 16; x < 256; x += 64) {
          c.fillStyle = '#303a3b';
          c.fillRect(x, y, 3, 3);
        }
      const rust = c.createLinearGradient(0, 170, 0, 256);
      rust.addColorStop(0, 'transparent');
      rust.addColorStop(1, 'rgba(86,47,25,.3)');
      c.fillStyle = rust;
      c.fillRect(0, 170, 256, 86);
    }
    if (kind === 'warning') {
      c.fillStyle = '#c6a84d';
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#333a39';
      for (let x = -256; x < 512; x += 64) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 32, 0);
        c.lineTo(x + 288, 256);
        c.lineTo(x + 256, 256);
        c.fill();
      }
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 2;
    return map;
  };
  const mat = (color: number, map?: THREE.Texture) => new THREE.MeshLambertMaterial({ color, map });
  return {
    distantSteel: new THREE.MeshBasicMaterial({ color: 0x718389 }),
    distantConcrete: new THREE.MeshBasicMaterial({ color: 0x93a3aa }),
    distantDark: new THREE.MeshBasicMaterial({ color: 0x4a5b64 }),
    concrete: mat(0xc1c6bd, texture('#87908c', 'concrete')),
    steel: mat(0xb4c4c4, texture('#55666a', 'metal')),
    dark: mat(0x465153),
    red: mat(0xd5b7a1, texture('#914b3d', 'metal')),
    blue: mat(0xb1cbd2, texture('#446b79', 'metal')),
    wood: mat(0xdac19c, texture('#9c8058', 'wood')),
    warning: mat(0xffffff, texture('#c6a84d', 'warning')),
    yellow: mat(0xc8a24c),
    rubber: mat(0x283132),
    glow: new THREE.MeshLambertMaterial({
      color: 0xffae4b,
      emissive: 0xff7018,
      emissiveIntensity: 1.2,
    }),
    lamp: new THREE.MeshLambertMaterial({
      color: 0xdde7cf,
      emissive: 0xdde7cf,
      emissiveIntensity: 0.8,
    }),
  };
}
export type Materials = ReturnType<typeof materials>;
