"""Bounded, offline-only static glTF 2 import. All uploaded bytes remain untrusted."""

import base64
import io
import json
import math
import struct
import warnings

from PIL import Image

from shared.errors import DomainError

MAX_BYTES = 50 * 1024**2
COMPONENTS = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def require(ok, message):
    if not ok:
        raise DomainError("Модель: " + message)


def finite(values, size):
    return (
        isinstance(values, list)
        and len(values) == size
        and all(type(v) in (int, float) and math.isfinite(v) and abs(v) <= 1e9 for v in values)
    )


def integer(value, maximum, label):
    require(type(value) is int and 0 <= value <= maximum, label)
    return value


def reference(items, index, label):
    integer(index, len(items) - 1, label)
    return items[index]


def embedded(uri, mime):
    require(
        isinstance(uri, str) and uri.startswith("data:"),
        "внешние ресурсы запрещены; экспортируйте самодостаточный GLB",
    )
    header, sep, data = uri.partition(",")
    require(sep and header in {f"data:{m};base64" for m in mime}, "неподдерживаемый data URI")
    try:
        result = base64.b64decode(data, validate=True)
    except ValueError:
        raise DomainError("Модель: повреждённый base64") from None
    require(len(result) <= MAX_BYTES, "слишком большой встроенный ресурс")
    return result


def matrix(node):
    if "matrix" in node:
        require(
            finite(node["matrix"], 16)
            and not any(k in node for k in ("translation", "rotation", "scale")),
            "неверная матрица узла",
        )
        m = node["matrix"]
        require(m[3] == m[7] == m[11] == 0 and m[15] == 1, "нужна аффинная матрица")
        return [m[i::4] for i in range(4)]
    t, q, s = (
        node.get("translation", [0, 0, 0]),
        node.get("rotation", [0, 0, 0, 1]),
        node.get("scale", [1, 1, 1]),
    )
    require(finite(t, 3) and finite(q, 4) and finite(s, 3), "неверный transform узла")
    require(abs(sum(v * v for v in q) - 1) < 0.001, "rotation должна быть единичным quaternion")
    x, y, z, w = q
    r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [[r[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def multiply(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def inspect_model(data, filename, mime):
    """Return canonical self-contained bytes, suffix, and verified import metadata."""
    try:
        return _inspect(data, filename, mime)
    except DomainError:
        raise
    except (
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        IndexError,
        struct.error,
        RecursionError,
        OverflowError,
    ):
        raise DomainError("Модель: повреждённая или неподдерживаемая структура GLTF/GLB") from None


def _inspect(data, filename, mime):
    suffix = filename.lower().rsplit(".", 1)[-1]
    require(suffix in ("glb", "gltf"), "поддерживаются только .glb и самодостаточный .gltf")
    require(
        mime
        in (
            "model/gltf-binary",
            "model/gltf+json",
            "application/octet-stream",
            "application/json",
            "",
        ),
        "недопустимый тип файла",
    )
    require(0 < len(data) <= MAX_BYTES, "лимит файла — 50 MiB")
    binary = None
    if suffix == "glb":
        require(len(data) >= 20, "обрезанный GLB")
        magic, version, size = struct.unpack_from("<4sII", data)
        require(magic == b"glTF" and version == 2 and size == len(data), "неверный заголовок GLB 2")
        chunks, offset = [], 12
        while offset < len(data):
            length, kind = struct.unpack_from("<II", data, offset)
            require(length % 4 == 0 and offset + 8 + length <= len(data), "повреждённый chunk GLB")
            chunks.append((kind, data[offset + 8 : offset + 8 + length]))
            offset += 8 + length
        require(
            1 <= len(chunks) <= 2 and chunks[0][0] == 0x4E4F534A,
            "GLB должен содержать JSON и необязательный BIN",
        )
        if len(chunks) == 2:
            require(chunks[1][0] == 0x004E4942, "неизвестный GLB chunk")
            binary = chunks[1][1]
        document = json.loads(chunks[0][1])
    else:
        document = json.loads(data)
    require(
        isinstance(document, dict) and document.get("asset", {}).get("version") == "2.0",
        "нужен glTF 2.0",
    )

    def scrub(value, depth=0):
        require(depth <= 48, "слишком глубокая структура")
        if isinstance(value, dict):
            require(
                not value.get("extensions"),
                "расширения GLTF пока не поддерживаются; экспортируйте core PBR без Draco/KTX",
            )
            return {
                k: scrub(v, depth + 1)
                for k, v in value.items()
                if k not in ("extras", "extensions", "animations", "cameras", "camera")
            }
        if isinstance(value, list):
            require(len(value) <= 10000, "слишком большой массив JSON")
            return [scrub(v, depth + 1) for v in value]
        if isinstance(value, float):
            require(math.isfinite(value), "NaN/Infinity запрещены")
        return value

    require(
        not document.get("extensionsRequired")
        and not document.get("extensionsUsed")
        and not document.get("skins"),
        "используйте static core glTF без skin/расширений",
    )
    animated = bool(document.get("animations"))
    document = scrub(document)
    buffers = []
    for i, b in enumerate(document.get("buffers", [])):
        length = integer(b.get("byteLength"), MAX_BYTES, "неверный размер buffer")
        content = (
            embedded(b["uri"], ("application/octet-stream", "application/gltf-buffer"))
            if "uri" in b
            else binary
        )
        require(
            content is not None and len(content) >= length and len(content) <= length + 3,
            "неверная длина buffer",
        )
        require("uri" in b or i == 0, "только первый buffer может ссылаться на GLB BIN")
        buffers.append(content[:length])
    require(sum(map(len, buffers)) <= MAX_BYTES, "слишком много данных buffers")
    views = []
    for b in document.get("bufferViews", []):
        content = reference(buffers, b.get("buffer"), "bufferView: неизвестный buffer")
        start, length = b.get("byteOffset", 0), b.get("byteLength")
        integer(start, len(content), "bufferView offset")
        integer(length, len(content) - start, "bufferView length")
        views.append(content[start : start + length])
    accessors, access_meta = [], document.get("accessors", [])
    total_elements = 0
    for a in access_meta:
        require(
            not a.get("sparse"), "sparse accessors не поддерживаются; экспортируйте обычные buffers"
        )
        fmt, width = COMPONENTS[a["componentType"]]
        n = WIDTHS[a["type"]]
        count = integer(a.get("count"), 500000, "accessor: максимум 500000 элементов")
        total_elements += count * n
        require(total_elements <= 8000000, "слишком много accessor данных")
        view = reference(views, a.get("bufferView"), "accessor: неизвестный bufferView")
        stride = document["bufferViews"][a["bufferView"]].get("byteStride", width * n)
        require(
            type(stride) is int and width * n <= stride <= 252 and stride % width == 0,
            "неверный stride",
        )
        offset = a.get("byteOffset", 0)
        integer(offset, len(view), "accessor offset")
        require(
            offset % width == 0
            and (not count or offset + (count - 1) * stride + width * n <= len(view)),
            "accessor вне buffer",
        )
        accessors.append((view, offset, stride, count, fmt, n))

    def values(index):
        view, start, stride, count, fmt, n = reference(accessors, index, "неизвестный accessor")
        for i in range(count):
            value = struct.unpack_from("<" + fmt * n, view, start + i * stride)
            require(
                all(math.isfinite(v) and abs(v) <= 1e9 for v in value),
                "неверные значения геометрии",
            )
            yield value

    textures, memory = [], 0
    require(len(document.get("images", [])) <= 32, "не более 32 текстур")
    for img in document.get("images", []):
        content = (
            embedded(img["uri"], ("image/png", "image/jpeg"))
            if "uri" in img
            else reference(views, img.get("bufferView"), "image: неизвестный bufferView")
        )
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as image:
                    require(
                        image.format in ("PNG", "JPEG") and max(image.size) <= 4096,
                        "текстуры: PNG/JPEG, максимум 4096×4096",
                    )
                    w, h = image.size
                    img["mimeType"] = "image/png" if image.format == "PNG" else "image/jpeg"
                    require(
                        memory + w * h * 4 * 4 // 3 <= 256 * 1024**2,
                        "текстуры превышают 256 MiB памяти",
                    )
                    image.verify()
                with Image.open(io.BytesIO(content)) as image:
                    image.load()
        except DomainError:
            raise
        except Exception:
            raise DomainError("Модель: повреждённая или слишком большая текстура") from None
        memory += w * h * 4 * 4 // 3
        textures.append(dict(width=w, height=h))
    require(
        len(textures) <= 32 and memory <= 256 * 1024**2,
        "лимит 32 текстуры / 256 MiB несжатой памяти",
    )
    for tex in document.get("textures", []):
        reference(textures, tex.get("source"), "texture: неизвестное изображение")
        if "sampler" in tex:
            reference(document.get("samplers", []), tex["sampler"], "неизвестный sampler")
    materials = document.get("materials", [])
    require(len(materials) <= 64, "не более 64 материалов")
    slots = {}

    def texture_ref(info):
        if info:
            reference(
                document.get("textures", []), info.get("index"), "материал: неизвестная texture"
            )
            require(info.get("texCoord", 0) in (0, 1), "поддерживаются UV0 и UV1")

    for i, mat in enumerate(materials):
        p = mat.get("pbrMetallicRoughness", {})
        col, em = p.get("baseColorFactor", [1, 1, 1, 1]), mat.get("emissiveFactor", [0, 0, 0])
        require(
            finite(col, 4) and finite(em, 3) and all(0 <= v <= 1 for v in col + em),
            "неверные PBR цвета",
        )
        for key in ("roughnessFactor", "metallicFactor"):
            v = p.get(key, 1)
            require(type(v) in (int, float) and 0 <= v <= 1, "PBR параметры: 0–1")
        require(mat.get("alphaMode", "OPAQUE") in ("OPAQUE", "MASK", "BLEND"), "неверный alphaMode")
        for info in (
            p.get("baseColorTexture"),
            p.get("metallicRoughnessTexture"),
            mat.get("normalTexture"),
            mat.get("occlusionTexture"),
            mat.get("emissiveTexture"),
        ):
            texture_ref(info)

        # glTF factors are linear; editor HEX is sRGB.
        def hexcolor(rgb):
            return "#" + "".join(
                f"{round(255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055)):02x}"
                for v in rgb
            )

        slots[f"material_{i}"] = dict(
            name=str(mat.get("name", f"Material {i + 1}"))[:100],
            fields={},
            variants={"default": dict(name="Imported", values={})},
            base=dict(
                baseColor=hexcolor(col[:3]),
                roughness=p.get("roughnessFactor", 1),
                metallic=p.get("metallicFactor", 1),
                emissiveColor=hexcolor(em),
                emissiveIntensity=1,
            ),
        )
    meshes = document.get("meshes", [])
    require(0 < len(meshes) <= 256, "нужно 1–256 meshes")
    bounds, counts = [], []
    unique_vertices = 0
    for mesh in meshes:
        low, high, vertices, triangles = [math.inf] * 3, [-math.inf] * 3, 0, 0
        require(0 < len(mesh.get("primitives", [])) <= 64, "mesh: 1–64 primitives")
        for p in mesh["primitives"]:
            require(
                p.get("mode", 4) == 4 and not p.get("targets"),
                "поддерживаются статические треугольники без morph targets",
            )
            attrs = p["attributes"]
            pos = reference(access_meta, attrs.get("POSITION"), "нужен POSITION")
            require(
                pos["type"] == "VEC3" and pos["componentType"] == 5126,
                "POSITION должен быть float VEC3",
            )
            count = pos["count"]
            unique_vertices += count
            require(unique_vertices <= 500000, "лимит 500000 vertices во всём файле")
            for attr in attrs.values():
                require(
                    reference(access_meta, attr, "неверный attribute")["count"] == count,
                    "разные размеры attributes",
                )
            pos_low, pos_high = [math.inf] * 3, [-math.inf] * 3
            for v in values(attrs["POSITION"]):
                for j in range(3):
                    pos_low[j], pos_high[j] = min(pos_low[j], v[j]), max(pos_high[j], v[j])
                    low[j], high[j] = min(low[j], v[j]), max(high[j], v[j])
            require(count > 0, "пустой POSITION")
            pos["min"], pos["max"] = pos_low, pos_high
            if "indices" in p:
                index = reference(access_meta, p["indices"], "неверные indices")
                require(
                    index["type"] == "SCALAR" and index["componentType"] in (5121, 5123, 5125),
                    "неверный тип indices",
                )
                require(all(v[0] < count for v in values(p["indices"])), "индекс вершины вне mesh")
                n = index["count"]
            else:
                n = count
            require(n % 3 == 0, "число индексов должно делиться на 3")
            if "material" in p:
                reference(materials, p["material"], "неизвестный material")
            vertices += count
            triangles += n // 3
        bounds.append((low, high))
        counts.append((vertices, triangles))
    nodes = document.get("nodes", [])
    require(len(nodes) <= 1024, "не более 1024 nodes")
    scene = reference(document.get("scenes", []), document.get("scene", 0), "нужна default scene")
    document["scenes"], document["scene"] = [scene], 0
    visited, low, high = set(), [math.inf] * 3, [-math.inf] * 3
    vertex_count = triangle_count = 0

    def visit(index, parent, depth):
        nonlocal vertex_count, triangle_count
        require(depth <= 32 and index not in visited, "цикл, повторный node или глубина >32")
        node = reference(nodes, index, "неизвестный node")
        visited.add(index)
        require("skin" not in node, "skinned mesh не поддерживается")
        transform = multiply(parent, matrix(node))
        if "mesh" in node:
            lo, hi = reference(bounds, node["mesh"], "неизвестный mesh")
            vc, tc = counts[node["mesh"]]
            vertex_count += vc
            triangle_count += tc
            require(
                vertex_count <= 500000 and triangle_count <= 300000,
                "лимит 500000 vertices / 300000 triangles в сцене",
            )
            for x in (lo[0], hi[0]):
                for y in (lo[1], hi[1]):
                    for z in (lo[2], hi[2]):
                        q = [x, y, z, 1]
                        for j in range(3):
                            value = sum(transform[j][k] * q[k] for k in range(4))
                            require(
                                math.isfinite(value) and abs(value) <= 1e9,
                                "слишком большие координаты",
                            )
                            low[j], high[j] = min(low[j], value), max(high[j], value)
        for child in node.get("children", []):
            visit(child, transform, depth + 1)

    for root in scene.get("nodes", []):
        visit(root, [[int(i == j) for j in range(4)] for i in range(4)], 0)
    require(vertex_count > 0, "сцена не содержит геометрии")
    issues = []
    if triangle_count > 50000 or memory > 64 * 1024**2:
        issues.append("Тяжёлый asset: частое повторение может снизить FPS")
    if animated:
        issues.append("Анимации удалены: asset используется как статическая модель")
    if any(m.get("alphaMode") == "BLEND" for m in materials):
        issues.append("Прозрачные материалы увеличивают стоимость отрисовки")
    payload = json.dumps(
        document, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode()
    if suffix == "glb":
        payload += b" " * (-len(payload) % 4)
        body = struct.pack("<II", len(payload), 0x4E4F534A) + payload
        if binary is not None:
            body += struct.pack("<II", len(binary), 0x004E4942) + binary
        payload = struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body
    return (
        payload,
        suffix,
        dict(
            bounds=[low, high],
            materialSlots=slots,
            performance=dict(
                vertices=vertex_count,
                triangles=triangle_count,
                meshes=len(meshes),
                materials=len(materials),
                textures=len(textures),
                textureBytes=memory,
                bytes=len(payload),
            ),
            warnings=issues,
        ),
    )
