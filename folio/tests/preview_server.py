"""Isolated browser-verification workspace. Contains synthetic writing only."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import FolioServer
from model_adapter import ModelError, ModelAdapter

class PreviewAdapter:
    def metadata(self):
        return {'models':[{'id':'synthetic','name':'Test model','recommended':True}], 'runtime':{'available':True,'localOnly':True}}
    def generate(self, model, messages, job, emit):
        payload=json.loads(messages[1]['content'])
        instruction=payload['instruction'].lower()
        if 'test failure' in instruction: raise ModelError('Synthetic model failure. Your document is unchanged.')
        if 'slow' in instruction:
            for _ in range(100):
                if job.cancelled.wait(.1):job.check()
        if 'test formatting only' in instruction:
            text=payload['draft'].replace('## Project update','# Project update').replace('María will follow up','- María will follow up')
        elif payload['mode']=='discuss':text='The draft says no decision was made.'
        elif payload.get('scope')=='selection':text='The team deferred the decision.'
        else:text='## Project update\n\nThe team reviewed the plan. No decision was made.\n\nMaría will follow up on October 3.'
        for word in text.split(' '):
            job.check();emit({'type':'delta','text':word+' '});time.sleep(.015)
        return {'type':'complete','text':text,'stats':{'stopReason':'eosFound'}}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8770);parser.add_argument('--real-model',action='store_true');args=parser.parse_args()
    root=Path(tempfile.mkdtemp(prefix='folio-ui-verification-'))
    server=FolioServer(('127.0.0.1',args.port),private_dir=root/'private',adapter=ModelAdapter(Path(__file__).resolve().parents[1]/'private') if args.real_model else PreviewAdapter())
    server.store.save({'sessions':[{'id':'synthetic-document','title':'Project update','source':'Team discussed plan. No vote. María follow up Oct 3.','draft':'','proposal':{'text':'## Project update\n\nThe team discussed the plan. No decision was made.\n\nMaría will follow up on October 3.'},'date':'','status':'draft','history':[],'versions':[]}],'examples':[],'settings':{} if args.real_model else {'model':'synthetic'}})
    print(f'Preview: http://127.0.0.1:{server.server_address[1]}  Synthetic storage: {root}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
