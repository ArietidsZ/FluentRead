import importlib.util,json,pathlib,sys,base64,datetime
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('neo',root.parent/'youtube-native-acceptance-20261007/neo-client.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
neo=mod.NeoClient()
print(json.dumps({'ready':True,'serverInfo':neo.server_info}),flush=True)
for line in sys.stdin:
    command=json.loads(line)
    if command.get('stop'):break
    tag=command['tag'];name=command['name'];args=command['arguments']
    try:
        result=neo.call(name,args)
        output=[]
        for i,item in enumerate(result.get('content',[])):
            if item.get('type')=='image':
                path=root/(tag+'-'+str(i)+('.png' if item['mimeType']=='image/png' else '.jpg'))
                path.write_bytes(base64.b64decode(item['data']));output.append({'type':'image','path':str(path)})
            elif item.get('type')=='text':
                text=item['text']
                if 'Tip: this session is' in text:text=text.split('Tip: this session is',1)[0].rstrip()
                output.append({'type':'text','text':text})
        record={'tool':name,'arguments':args,'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'content':output,'success':True}
        (root/(tag+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'tag':tag,'content':output},ensure_ascii=False)[:14000],flush=True)
    except Exception as e:
        message=str(e)
        record={'tool':name,'arguments':args,'success':False,'error':message[:2000]}
        (root/(tag+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'tag':tag,'error':message[:2000]}),flush=True)
