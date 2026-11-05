# Đọc nhiều câu tiếng Việt bằng VieNeu-TTS, nạp mô hình một lần (tools/tiktok.mjs gọi).
# Chạy bằng Python của môi trường riêng: .venv-vieneu/Scripts/python.exe tools/vieneu_tts.py <jobs.json>
# jobs.json: {"voice": "Trúc Ly", "items": [{"text": "câu đọc", "out": "D:/.../voice-01.wav"}]}
import io
import json
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from vieneu import Vieneu  # noqa: E402

with open(sys.argv[1], encoding="utf-8") as f:
    job = json.load(f)
tts = Vieneu()
for item in job["items"]:
    try:
        tts.save(tts.infer(item["text"], voice=job["voice"]), item["out"])
        print("ok", item["out"], flush=True)
    except Exception as e:  # câu lỗi thì bỏ qua, tiktok.mjs đọc câu đó bằng giọng dự phòng
        print("loi", item["out"], e, flush=True)
