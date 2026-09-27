import json,re,os
B=os.path.dirname(os.path.abspath(__file__))
NPM="/tmp/claude-0/-home-user----/b0444d96-7acd-5a9a-9464-ae74c9bed591/scratchpad/npm/"
t=open(B+"/template.html").read()
three=open(NPM+"three-0.160.0/build/three.min.js").read()
ffl=open(NPM+"fflate-0.8.2/umd/index.js").read()
data=""
for c in ("hk",):
    meta=open(f"{B}/meta_{c}.json").read()
    data+=f'<script type="application/json" id="m_{c}">{meta}</script>\n<script type="text/plain" id="d_{c}">{open(f"{B}/data_{c}.b64").read()}</script>\n'
plans=open(B+"/plan_hk.js").read()
app=open(B+"/app.js").read()
for s in (three,ffl,plans,app): assert "</script" not in s.lower()
t=t.replace("<script>/*THREE*/</script>","<script>"+three+"</script>").replace("<script>/*FFLATE*/</script>","<script>"+ffl+"</script>")
t=t.replace("<!--DATA-->",data).replace("<script>/*PLANS*/</script>","<script>"+plans+"</script>").replace("<script>/*APP*/</script>","<script>"+app+"</script>")
head,body=t.split("<!--BODY-->")
full='<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'+head+'</head>\n<body>\n'+body+'</body>\n</html>\n'
out=os.path.join(B,"..","family-trip-december.html")
open(out,"w").write(full)
art="/tmp/claude-0/-home-user----/b0444d96-7acd-5a9a-9464-ae74c9bed591/scratchpad/family-trip.html"
open(art,"w").write(head+body)
print(len(full.encode())/1e6,"MB")
