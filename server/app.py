import sys
from pathlib import Path
from flask import Flask, render_template, request, jsonify

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from interpreter import run_pulse, PulseRuntimeError  

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/run", methods=["POST"])
def run():
    source = request.json.get("source", "")
    try:
        output, pulses = run_pulse(source)
        return jsonify({
            "ok": True,
            "output": output,
            "pulses": [{"kind": k, "detail": d} for k, d in pulses],
        })
    except PulseRuntimeError as e:
        return jsonify({"ok": False, "error": f"runtime error: {e}"})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"})


@app.route("/sample/<name>")
def sample(name):
    safe = "".join(c for c in name if c.isalnum() or c in "_-")
    path = ROOT / "programs" / f"{safe}.pulse"
    if not path.exists():
        return jsonify({"ok": False, "error": "not found"}), 404
    return jsonify({"ok": True, "source": path.read_text()})


if __name__ == "__main__":
    app.run(debug=True, port=5000)