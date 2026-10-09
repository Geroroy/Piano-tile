import json, os, re, subprocess, sys, struct
# Salamander Grand Piano V3 → 웹용 샘플 변환 (사용법: python3 tools/convert-salamander.py <SalamanderGrandPiano 저장소> samples/salamander)
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
# 16단계 중 8단계 (발라드에 많이 쓰이는 세기 33·49·94·112·127 을 고르게 덮도록)
layers = [('v2', 1, 36), ('v5', 37, 50), ('v7', 51, 60), ('v9', 61, 76), ('v11', 77, 90), ('v12', 91, 100), ('v14', 101, 116), ('v16', 117, 127)]
region = subprocess.run(['git', '-C', src, 'show', 'HEAD:Data/region.txt'], capture_output=True, text=True).stdout
regs = [(int(a), int(b), int(c), d) for a, b, c, d in re.findall(r'lokey=(\d+) hikey=(\d+) pitch_keycenter=(\d+) sample=(\S+?)\$VEL', region)]

def onset(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-f', 's16le', '-t', '0.6', '-'], capture_output=True).stdout
    n = len(raw) // 2
    v = struct.unpack('<%dh' % n, raw[:n * 2])
    pk = max(abs(x) for x in v) or 1
    for i, x in enumerate(v):
        if abs(x) > pk * 0.04:
            return max(0, i / 48000 - 0.002)
    return 0

def enc(inp, fn, start, dur, fade, args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '%.4f' % start, '-i', inp, '-t', str(dur),
                    '-af', 'afade=t=out:st=%.2f:d=%.2f' % (dur - fade, fade), '-ar', '44100'] + args + [os.path.join(out, fn)], check=True)

man = {'source': 'Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0)', 'layers': [], 'release': []}
total = 0
for name, lo, hi in layers:
    rr = []
    for lok, hik, kc, smp in regs:
        inp = os.path.join(src, 'Samples', '%s%s.flac' % (smp, name))
        # 길이: 낮은 음일수록 길게 (페달로 오래 울릴 때도 자연스럽게)
        dur = 8.0 if kc < 45 else 6.0 if kc < 60 else 4.5 if kc < 75 else 3.5 if kc < 90 else 2.5
        fn = '%s-%03d.mp3' % (name, kc)
        enc(inp, fn, onset(inp), dur, 1.6, ['-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '80k'])
        total += os.path.getsize(os.path.join(out, fn))
        rr.append({'lo': lok, 'hi': hik, 'key': kc, 'file': fn})
    man['layers'].append({'name': name, 'lovel': lo, 'hivel': hi, 'regions': rr})
# 건반을 놓을 때 나는 소리 (88건반 각각)
for k in range(1, 89):
    inp = os.path.join(src, 'Samples', 'rel%d.flac' % k)
    fn = 'rel-%03d.mp3' % (20 + k)
    enc(inp, fn, 0, 1.0, 0.5, ['-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '48k'])
    total += os.path.getsize(os.path.join(out, fn))
    man['release'].append({'key': 20 + k, 'file': fn})
json.dump(man, open(os.path.join(out, 'manifest.json'), 'w'), separators=(',', ':'))
print('files', len(os.listdir(out)), 'MB', round(total / 1e6, 2))
