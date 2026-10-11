"""Opt-in synthetic checks against an already running editor at localhost:8765."""
import http.client
import json

HOST, PORT = "127.0.0.1", 8765


def request(path, body=None, token=None):
    connection = http.client.HTTPConnection(HOST, PORT, timeout=700)
    headers = {}
    if body is not None:
        headers = {"Content-Type": "application/json", "X-Folio-Token": token}
    connection.request("GET" if body is None else "POST", path, None if body is None else json.dumps(body), headers)
    return connection, connection.getresponse()


def main():
    connection, response = request("/api/bootstrap")
    bootstrap = json.load(response)
    connection.close()
    token, model = bootstrap["token"], bootstrap["models"][0]["id"]
    source = "Finance. Cash $2.4m at Aug 31. Dana estimates 14 months runway, unconfirmed. Budget NOT approved; revisit Sept30. Lee sends revised forecast by Friday. No hiring approval."
    payload = {"requestId": "http-live-polish", "mode": "polish", "source": source, "model": model,
               "settings": {"voice": "Use compact, professional sentences."}}
    connection, response = request("/api/generate", payload, token)
    assert response.status == 200
    events = [json.loads(line) for line in response if line.strip()]
    connection.close()
    complete = next((event for event in events if event["type"] == "complete"), None)
    assert complete, events
    assert complete["stats"]["stopReason"] in ("eosFound", "stopStringFound")
    assert "referenceInfo" in complete
    print(json.dumps({"check": "http-polish", "text": complete["text"], "stats": complete["stats"]}), flush=True)

    connection, response = request("/api/generate", {**payload, "requestId": "http-live-context", "source": "ab " * 7900}, token)
    assert response.status == 200
    events = [json.loads(line) for line in response if line.strip()]
    connection.close()
    assert not any(event["type"] in ("delta", "complete") for event in events), events
    assert events[-1]["type"] == "error", events
    print(json.dumps({"check": "http-context", "error": events[-1]["message"]}), flush=True)

    connection, response = request("/api/generate", {**payload, "requestId": "http-live-cancel"}, token)
    assert response.status == 200
    events, cancelled = [], False
    for line in response:
        if not line.strip():
            continue
        event = json.loads(line)
        events.append(event)
        if event["type"] == "delta" and not cancelled:
            cancel_connection, cancel_response = request("/api/cancel", {"requestId": "http-live-cancel"}, token)
            assert json.load(cancel_response)["cancelled"]
            cancel_connection.close()
            cancelled = True
    connection.close()
    assert cancelled
    assert not any(event["type"] == "complete" for event in events)
    assert events[-1]["type"] == "error" and events[-1]["cancelled"]
    print(json.dumps({"check": "http-cancel", "cancelled": True, "complete": False}), flush=True)
    print("LIVE HTTP CHECK COMPLETE", flush=True)


if __name__ == "__main__":
    main()
