"""Insert the activity bridge before untrusted content, including HTML fragments."""

import re

BRIDGE = """<script>(()=>{const session=new URLSearchParams(location.hash.slice(1)).get("session");
if(session)["pointerdown","keydown","touchstart"].forEach(type=>addEventListener(type,
()=>parent.postMessage({type:"gamehub:input",session},"*"),{passive:true}));})();</script>"""


def instrument_html(content: bytes) -> bytes:
    document = content.decode("utf-8-sig")
    # Keep standards mode, even for uploaded fragments with an omitted doctype.
    document = re.sub(r"^\s*<!doctype[^>]*>", "", document, count=1, flags=re.IGNORECASE)
    return ("<!doctype html>" + BRIDGE + document).encode("utf-8")
