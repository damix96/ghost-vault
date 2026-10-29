import argparse
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.wheel_input import ScrollOrigin
from selenium.webdriver.common.keys import Keys


class BrowserOperator:
    def __init__(self, args):
        self.output = Path(args.output).resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.position = (0, 0)
        self.counter = 0
        options = Options()
        options.add_argument('--headless=new')
        options.add_argument('--window-size=1920,1080')
        options.add_argument('--disable-gpu')
        if args.chrome:
            options.binary_location = args.chrome
        self.driver = webdriver.Chrome(options=options)
        self.driver.set_page_load_timeout(20)
        self.resize(1920, 1080)
        self.driver.get(args.url)

    def resize(self, width, height):
        if not 320 <= width <= 3840 or not 320 <= height <= 2160:
            raise ValueError('Viewport must be within 320..3840 by 320..2160')
        self.driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {
            'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})

    def target(self, text):
        matches = self.driver.execute_script('''
          const query = arguments[0], found = [];
          const visit = root => {
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) visit(el.shadowRoot);
              const box = el.getBoundingClientRect(), style = getComputedStyle(el);
              if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'none') continue;
              if (box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) continue;
              const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
              if (own === query || el.placeholder === query || (el.tagName === 'INPUT' && ['submit','button'].includes(el.type) && el.value === query)) found.push(el);
            }
          };
          visit(document);
          return found;
        ''', text)
        if len(matches) != 1:
            raise ValueError(f'Visible exact text has {len(matches)} matches. Use screenshot coordinates to disambiguate.')
        return matches[0]

    def move(self, request):
        chain = ActionChains(self.driver)
        if request.get('target'):
            element = self.target(request['target'])
            chain.move_to_element(element).perform()
            rect = element.rect
            self.position = self.driver.execute_script('const r=arguments[0].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]', element)
        elif request.get('x') is not None and request.get('y') is not None:
            self.position = (int(request['x']), int(request['y']))
            chain.w3c_actions.pointer_action.move_to_location(*self.position)
            chain.perform()

    def cursor(self):
        return self.driver.execute_script('''
          let el=document.elementFromPoint(arguments[0],arguments[1]);
          while(el?.shadowRoot){const child=el.shadowRoot.elementFromPoint(arguments[0],arguments[1]);if(!child||child===el)break;el=child;}
          return el?getComputedStyle(el).cursor:'outside';
        ''', *self.position)

    def execute(self, request):
        action = request.get('action', 'screenshot')
        result = {'status': 'success', 'action': action}
        try:
            if action in ['hover', 'click', 'doubleclick', 'type']:
                self.move(request)
            if action == 'click':
                ActionChains(self.driver).click().perform()
            elif action == 'doubleclick':
                ActionChains(self.driver).double_click().perform()
            elif action == 'type':
                if request.get('target') or request.get('x') is not None:
                    ActionChains(self.driver).click().perform()
                if request.get('clear'):
                    ActionChains(self.driver).key_down(Keys.CONTROL).send_keys('a').key_up(Keys.CONTROL).send_keys(Keys.BACKSPACE).perform()
                ActionChains(self.driver).send_keys(request.get('value', '')).perform()
            elif action in ['key', 'keydown', 'keyup']:
                key = getattr(Keys, request.get('key', '').upper(), request.get('key', ''))
                if not key:
                    raise ValueError('Key is required')
                chain = ActionChains(self.driver)
                {'key': chain.send_keys, 'keydown': chain.key_down, 'keyup': chain.key_up}[action](key).perform()
            elif action == 'scroll':
                self.move(request)
                ActionChains(self.driver).scroll_from_origin(ScrollOrigin.from_viewport(*self.position), int(request.get('dx', 0)), int(request.get('dy', 600))).perform()
            elif action == 'resize':
                self.resize(int(request.get('width', 1920)), int(request.get('height', 1080)))
            elif action == 'back':
                self.driver.back()
            elif action == 'forward':
                self.driver.forward()
            elif action == 'reload':
                self.driver.refresh()
            elif action not in ['screenshot', 'hover', 'close']:
                raise ValueError('Unsupported action')
            time.sleep(min(max(float(request.get('wait', 0.8)), 0), 3))
        except Exception as error:
            result.update(status='error', error=str(error).split('Stacktrace:')[0])
        self.counter += 1
        path = self.output / f'screen-{self.counter:04d}.png'
        try:
            self.driver.save_screenshot(str(path))
            result.update(screenshot=str(path), cursor=self.cursor(), url=self.driver.current_url)
        except Exception as error:
            result.update(status='error', screenshot_error=str(error).split('Stacktrace:')[0])
        with (self.output.parent / 'actions.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'request': request, 'result': result}, ensure_ascii=False) + '\n')
        return result


class OperatorHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != '/action' or self.headers.get('Authorization') != 'Bearer ' + self.server.token:
            self.send_error(403)
            return
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 1048576:
                raise ValueError('Invalid request size')
            request = json.loads(self.rfile.read(size))
            result = self.server.operator.execute(request)
            payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            if request.get('action') == 'close':
                threading.Thread(target=self.server.shutdown, daemon=True).start()
        except Exception as error:
            self.send_error(400, str(error))


class OperatorCli:
    @staticmethod
    def run():
        parser = argparse.ArgumentParser(description='Persistent headless visual browser')
        parser.add_argument('--serve', action='store_true')
        parser.add_argument('--session', required=True)
        parser.add_argument('--url')
        parser.add_argument('--output')
        parser.add_argument('--chrome')
        parser.add_argument('--port', type=int, default=0)
        parser.add_argument('--action', default='screenshot', choices=['screenshot','hover','click','doubleclick','type','key','keydown','keyup','scroll','resize','back','forward','reload','close'])
        parser.add_argument('--target')
        parser.add_argument('--value')
        parser.add_argument('--key')
        parser.add_argument('--clear', action='store_true')
        for name in ['x','y','dx','dy','width','height']:
            parser.add_argument('--' + name, type=int)
        parser.add_argument('--wait', type=float, default=0.8)
        args = parser.parse_args()
        session = Path(args.session).resolve()
        if args.serve:
            if not args.url or not args.output:
                parser.error('--serve requires --url and --output')
            operator = BrowserOperator(args)
            server = HTTPServer(('127.0.0.1', args.port), OperatorHandler)
            server.operator = operator
            server.token = uuid.uuid4().hex
            session.parent.mkdir(parents=True, exist_ok=True)
            session.write_text(json.dumps({'endpoint': f'http://127.0.0.1:{server.server_port}/action', 'token': server.token}), encoding='utf-8')
            print(json.dumps(operator.execute({'action': 'screenshot'}), ensure_ascii=False), flush=True)
            try:
                server.serve_forever()
            finally:
                operator.driver.quit()
                server.server_close()
                session.unlink(missing_ok=True)
        else:
            connection = json.loads(session.read_text(encoding='utf-8'))
            excluded = ['serve','session','url','output','chrome','port']
            payload = {key: value for key, value in vars(args).items() if key not in excluded and value is not None}
            request = Request(connection['endpoint'], data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + connection['token']})
            with urlopen(request, timeout=35) as response:
                result = json.loads(response.read())
            print(json.dumps(result, ensure_ascii=False, indent=2))
            if result.get('status') == 'error':
                raise SystemExit(1)


if __name__ == '__main__':
    OperatorCli.run()
