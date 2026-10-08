"""Explicit opt-in smoke check using synthetic meeting material only.

Run manually, outside any network sandbox. No test
transcript is persisted. The private runtime marker contains process metadata.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_adapter import Job, ModelAdapter, discover
from prompts import build_messages
from server import PrivateStore

def main():
    private = PrivateStore(Path(__file__).resolve().parents[1] / "private")
    model = discover()[0]
    adapter = ModelAdapter(private.directory)
    source = "Finance update. Cash $2.4m at Aug 31. Dana thinks runway about 14 months, not confirmed. Budget proposal NOT approved; revisit Sept 30. Lee to send revised forecast by Friday. No new hires approved."
    draft = ""
    for mode, instruction in [("polish", ""), ("revise", "Keep every fact and make this more concise."), ("discuss", "Is it clear that the budget was not approved? Give a short assessment, not a rewrite.")]:
        payload = {"mode": mode, "source": source, "draft": draft, "instruction": instruction,
                   "examples": [{"type": "writing", "name": "Synthetic style", "text": "Operations. The committee discussed delivery timelines. A revised plan will return for review."}]}
        messages, info = build_messages(payload)
        def emit(event):
            if event["type"] == "status":
                print(event["text"], flush=True)
        result = adapter.generate(model["id"], messages, Job("live-" + mode), emit)
        print(json.dumps({"mode": mode, "text": result["text"], "stats": result["stats"], "references": info}), flush=True)
        if mode != "discuss":
            draft = result["text"]
    print("LIVE MODEL CHECK COMPLETE", flush=True)

if __name__ == "__main__":
    main()
