#!/usr/bin/env python3
"""index.html 과 css/js/곡/작곡가 파일을 HTML 파일 하나로 합친다 (이미지는 data URI 로 포함).
사용법: python3 tools/bundle.py 출력.html [--fragment]
--fragment: <html>/<head>/<body> 없이 본문만 출력 (Claude 아티팩트 게시용)
"""
import base64, mimetypes, os, re, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
out_path = sys.argv[1]
fragment = '--fragment' in sys.argv

def read(p):
    with open(os.path.join(root, p), encoding='utf-8') as f:
        return f.read()

def inline_images(js):
    # 'composers/xxx.jpg' 같은 상대 경로 이미지를 data URI 로 바꾼다 (파일이 있을 때만)
    def rep(m):
        p = m.group(2)
        full = os.path.join(root, p)
        if not os.path.exists(full):
            return m.group(0)
        mime = mimetypes.guess_type(p)[0] or 'application/octet-stream'
        data = base64.b64encode(open(full, 'rb').read()).decode()
        return m.group(1) + 'data:' + mime + ';base64,' + data + m.group(1)
    return re.sub(r"(['\"])([\w/.-]+\.(?:jpe?g|png|webp|gif))\1", rep, js)

html = read('index.html')
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<!--.*?-->\s*', '', body, flags=re.S)
body = re.sub(r'<script src="([^"]+)"></script>',
              lambda m: '<script>\n' + inline_images(read(m.group(1))) + '\n</script>', body)
fonts = ''.join(m + '\n' for m in re.findall(r'<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>', html))
head = ('<title>Piano Tiles</title>\n<meta name="theme-color" content="#2a0c12">\n' + fonts
        + '<style>\n' + read('css/style.css') + '\n</style>\n')
if fragment:
    out = head + body.strip() + '\n'
else:
    out = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n'
           + head + '</head>\n<body>\n' + body.strip() + '\n</body>\n</html>\n')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(out)
print('wrote', out_path, len(out), 'bytes')
