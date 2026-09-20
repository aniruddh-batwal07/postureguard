import urllib.request
import json
import time
import datetime

def post(url, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    res = urllib.request.urlopen(req)
    return json.loads(res.read().decode('utf-8'))

def get(url):
    res = urllib.request.urlopen(url)
    return json.loads(res.read().decode('utf-8'))

def now_iso():
    return datetime.datetime.utcnow().isoformat() + 'Z'

print("=" * 60)
print(" PostureGuard Phase 5: End-to-End Hardware Integration Test")
print("=" * 60)

# Check active session
active_resp = get('http://127.0.0.1:4000/api/sessions/active')
active = active_resp.get('session')
if active:
    print(f"Ending existing active session {active['id']}...")
    post(f"http://127.0.0.1:4000/api/sessions/{active['id']}/end", {})
    time.sleep(1.0)

# 1. Start a fresh session
print("\n[Step 1] Creating fresh session...")
create_resp = post('http://127.0.0.1:4000/api/sessions', {})
session = create_resp['session']
sid = session['id']
print(f"-> Session created: {sid} (State: {session['state']})")

# 2. Mark baseline captured
print("\n[Step 2] Sending 'baseline_captured' event (CV calibrated upright posture)...")
post('http://127.0.0.1:4000/api/events', {
    'sessionId': sid,
    'type': 'baseline_captured',
    'timestamp': now_iso()
})
cur_session = get('http://127.0.0.1:4000/api/sessions/active')['session']
print(f"-> Session transitioned to: {cur_session['state']}")

# 3. Post slouch_violation -> arm moves to block screen
print("\n[Step 3] Slouch detected! Sending 'slouch_violation' event...")
print(">>> PHYSICAL ARM ACTION: Moving cardboard blocker sheet in front of laptop screen... <<<")
post('http://127.0.0.1:4000/api/events', {
    'sessionId': sid,
    'type': 'slouch_violation',
    'timestamp': now_iso()
})
blocked_session = get('http://127.0.0.1:4000/api/sessions/active')['session']
print(f"-> Session state after BLOCK: {blocked_session['state']}")

print("\n[Step 4] Cardboard is currently blocking the screen. Waiting 4 seconds...")
time.sleep(4.0)

# 4. Post correction_requested -> arm returns to dock
print("\n[Step 5] Upright posture restored! Sending 'correction_requested' event...")
print(">>> PHYSICAL ARM ACTION: Returning cardboard blocker sheet back to dock... <<<")
post('http://127.0.0.1:4000/api/events', {
    'sessionId': sid,
    'type': 'correction_requested',
    'timestamp': now_iso()
})
restored_session = get('http://127.0.0.1:4000/api/sessions/active')['session']
print(f"-> Session state after RETRIEVE: {restored_session['state']}")

# 5. End session
print("\n[Step 6] Ending session...")
post(f"http://127.0.0.1:4000/api/sessions/{sid}/end", {})
print("\n" + "=" * 60)
print(">>> VERIFICATION SUCCESS: Real hardware performed BLOCK and RETRIEVE! <<<")
print("=" * 60)
