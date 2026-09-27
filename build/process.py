import pickle, json, math, zlib, base64, heapq, sys, hashlib
import shapely
from shapely import wkb
from shapely.geometry import box, Polygon, MultiPolygon, LineString, MultiLineString, Point
from shapely.ops import unary_union
SC="/tmp/claude-0/-home-user----/b0444d96-7acd-5a9a-9464-ae74c9bed591/scratchpad/"
import numpy as np
SPEC=json.load(open("routes_spec.json"))
C=sys.argv[1]; S=SPEC[C]
lon0,lat0=S["origin"]; KX=math.cos(math.radians(lat0))*111320.0; KY=110540.0
def P(lon,lat): return ((lon-lon0)*KX, -(lat-lat0)*KY)   # x east, z south (three.js)
def proj(g): return shapely.transform(g, lambda a: np.column_stack(((a[:,0]-lon0)*KX, -(a[:,1]-lat0)*KY)))
def L(n): return pickle.load(open(SC+f"raw_{C}_{n}.pkl","rb"))
Rb=S["region"]; RB=proj(box(*Rb))
DB={k:proj(box(*v)) for k,v in S["details"].items()}
DUN=unary_union([b.buffer(150) for b in DB.values()])
# ---------- encoder ----------
buf=bytearray()
def vu(n):
    while True:
        b=n&0x7f; n>>=7
        if n: buf.append(b|0x80)
        else: buf.append(b); return
def zz(n): return (n<<1) ^ (n>>63)
feats={"region":[], "detail":[], "bld":[]}
def rings_of(g):
    out=[]
    if g.is_empty: return out
    if isinstance(g,(Polygon,)):
        out.append(list(g.exterior.coords)); out+= [list(i.coords) for i in g.interiors]; return [out]
    if isinstance(g,MultiPolygon) or g.geom_type=="GeometryCollection":
        r=[]
        for s in g.geoms: r+=rings_of(s)
        return r
    if isinstance(g,LineString): return [[list(g.coords)]]
    if isinstance(g,MultiLineString): return [[list(s.coords)] for s in g.geoms]
    return []
def add(pool,kind,g,attr=0,tol=0.0,minarea=0):
    if g is None or g.is_empty: return
    if tol: g=g.simplify(tol,preserve_topology=True)
    for parts in rings_of(g):
        if not parts: continue
        if parts[0] and len(parts[0])>2 and parts[0][0]==parts[0][-1] and minarea and Polygon(parts[0]).area<minarea: continue
        feats[pool].append((kind,attr,parts))
def encode(lst):
    global buf; buf=bytearray()
    vu(len(lst))
    for kind,attr,parts in lst:
        vu(kind); vu(attr); vu(len(parts))
        for r in parts:
            pts=[(int(round(x*2)),int(round(y*2))) for x,y in r]
            ded=[pts[0]]
            for p in pts[1:]:
                if p!=ded[-1]: ded.append(p)
            vu(len(ded)); px=py=0
            for x,y in ded: vu(zz(x-px)); vu(zz(y-py)); px,py=x,y
    return bytes(buf)
# ---------- land ----------
land=[proj(wkb.loads(r["geometry"])) for r in L("land") if r["subtype"]=="land"]
land=[g for g in land if g.geom_type in("Polygon","MultiPolygon")]
landU=unary_union([g.intersection(RB) for g in land])
add("region",1,landU,tol=25)
for r in L("land"):
    if r["subtype"] in("forest",) or r["class"] in("wood","forest"):
        g=proj(wkb.loads(r["geometry"]))
        if g.geom_type not in("Polygon","MultiPolygon"): continue
        gi=g.intersection(RB)
        if gi.area>60000: add("region",3,gi,tol=30,minarea=60000)
        gd=g.intersection(DUN)
        if not gd.is_empty and gd.area>200: add("detail",3,gd,tol=1)
    elif r["subtype"] in("grass","sand","wetland") :
        g=proj(wkb.loads(r["geometry"]))
        if g.geom_type not in("Polygon","MultiPolygon"): continue
        gd=g.intersection(DUN)
        if not gd.is_empty and gd.area>100: add("detail",4 if r["subtype"]!="sand" else 7,gd,tol=1)
# ---------- water ----------
for r in L("water"):
    g=proj(wkb.loads(r["geometry"]))
    if r["class"] in ("swimming_pool","wastewater"): continue
    if g.geom_type in("Polygon","MultiPolygon"):
        if r["subtype"]=="ocean" or r.get("is_salt"): continue
        gi=g.intersection(RB)
        if gi.area>15000: add("region",2,gi,tol=20,minarea=15000)
        gd=g.intersection(DUN)
        if not gd.is_empty: add("detail",2,gd,tol=0.8)
    elif g.geom_type in("LineString","MultiLineString"):
        if r["class"]=="river":
            add("region",19,g.intersection(RB),tol=20)
        gd=g.intersection(DUN)
        if not gd.is_empty and r["class"] in("river","stream","canal"): add("detail",19 if r["class"]!="stream" else 20,gd,tol=1)
# ---------- landuse ----------
PARK={"park","recreation","golf","cemetery","horticulture","managed","agriculture"}
URB={"residential","developed","education","medical","military","religious","transportation","construction"}
for r in L("landuse"):
    g=proj(wkb.loads(r["geometry"]))
    if g.geom_type not in("Polygon","MultiPolygon"): continue
    st=r["subtype"]
    if st in PARK:
        k=4
    elif st in URB: k=5
    elif st=="pedestrian": k=6
    else: continue
    if k in(4,5):
        gi=g.intersection(RB)
        if gi.area>40000: add("region",k,gi,tol=25,minarea=40000)
    if k in(4,6) or (k==5 and st in ("education","medical","religious")):
        gd=g.intersection(DUN)
        if not gd.is_empty and gd.area>80: add("detail",k if k!=5 else 8,gd,tol=0.8)
# ---------- segments ----------
RC={"motorway":10,"trunk":11,"primary":12,"secondary":13,"tertiary":14,"residential":15,"unclassified":15,"living_street":15,"service":16,"footway":17,"path":17,"pedestrian":17,"steps":18,"cycleway":17,"track":16}
segs=L("seg")
graph_edges=[]
for r in segs:
    g=proj(wkb.loads(r["geometry"]))
    st=r["subtype"]; cl=r["class"]
    if st=="road":
        k=RC.get(cl)
        if not k: continue
        if k<=12 or (k==13 and C=="tw"): add("region",k,g.intersection(RB),tol=12)
        gd=g.intersection(DUN)
        if not gd.is_empty: add("detail",k,gd,tol=0.6)
        graph_edges.append(("road",cl,g))
    elif st=="rail":
        if cl in("subway",): kk=22
        elif cl in("tram","light_rail","monorail","funicular"): kk=23
        else: kk=21
        if kk!=22: add("region",kk,g.intersection(RB),tol=12)
        gd=g.intersection(DUN)
        if not gd.is_empty: add("detail",kk,gd,tol=0.6)
        graph_edges.append(("rail",cl,g))
# ---------- buildings ----------
import random
bl=L("bld"); nb=0
for r in bl:
    ds=set(s["dataset"] for s in (r["sources"] or []))
    if "OpenStreetMap" not in ds: continue
    g=proj(wkb.loads(r["geometry"]))
    if g.geom_type=="MultiPolygon": g=max(g.geoms,key=lambda a:a.area)
    if g.geom_type!="Polygon" or g.area<12: continue
    h=r["height"]
    if not h and r["num_floors"]: h=r["num_floors"]*3.3
    est=0
    if not h:
        a=g.area; hsh=int(hashlib.md5(str(g.centroid.coords[0]).encode()).hexdigest()[:4],16)/65535
        if a>3000: h=16+hsh*14
        elif a>800: h=10+hsh*10
        elif a>200: h=6+hsh*6
        else: h=4+hsh*3
        est=1
    h=max(3,min(h,520))
    g=g.simplify(0.4,preserve_topology=True)
    if g.is_empty or g.geom_type!="Polygon": continue
    ring=list(g.exterior.coords)
    feats["bld"].append((30+est,int(h*10),[ring]))
    nb+=1
print(C,"buildings",nb)
# ---------- routing ----------
def key(p): return (round(p[0],1),round(p[1],1))
MODES={"walk":{"road"},"taxi":{"car"},"van":{"car"},"bus":{"car"},"train":{"rail"}}
CARX={"footway","path","pedestrian","steps","cycleway","track","bridleway"}
G={"road":{}, "car":{}, "rail":{}}
def addedge(gr,a,b,w,line):
    G[gr].setdefault(a,[]).append((b,w,line))
for typ,cl,g in graph_edges:
    lines=[g] if g.geom_type=="LineString" else list(getattr(g,"geoms",[]))
    for ln in lines:
        cs=list(ln.coords)
        for i in range(len(cs)-1):
            a,b=key(cs[i]),key(cs[i+1]); d=math.dist(cs[i],cs[i+1])
            if typ=="road":
                addedge("road",a,b,d,None); addedge("road",b,a,d,None)
                if cl not in CARX:
                    f={"motorway":0.45,"trunk":0.55,"primary":0.7,"secondary":0.8,"tertiary":0.9}.get(cl,1.0)
                    addedge("car",a,b,d*f,None); addedge("car",b,a,d*f,None)
            else:
                if cl in("subway","tram"): continue
                addedge("rail",a,b,d,None); addedge("rail",b,a,d,None)
import bisect
nodes_cache={}
def nearest(gr,p):
    if gr not in nodes_cache:
        ks=list(G[gr].keys()); nodes_cache[gr]=(np.array(ks),ks)
    arr,ks=nodes_cache[gr]; d=((arr[:,0]-p[0])**2+(arr[:,1]-p[1])**2); i=int(d.argmin()); return ks[i],math.sqrt(d[i])
def dijkstra(gr,s,t):
    dist={s:0};prev={};pq=[(0,s)];tx,ty=t
    while pq:
        d,u=heapq.heappop(pq)
        if u==t: break
        if d>dist.get(u,1e18): continue
        for v,w,_ in G[gr].get(u,()):
            nd=d+w
            if nd<dist.get(v,1e18):
                dist[v]=nd; prev[v]=u; heapq.heappush(pq,(nd+0*math.dist(v,t),v))
    if t not in dist: return None
    path=[t]
    while path[-1]!=s: path.append(prev[path[-1]])
    return path[::-1]
routes=[]
for di,day in enumerate(S["days"]):
    legs=[]
    for a,b,mode in day:
        pa=P(*S["stops"][a]); pb=P(*S["stops"][b])
        gr=list(MODES[mode])[0]
        na,da=nearest(gr,pa); nb_,db=nearest(gr,pb)
        path=dijkstra(gr,na,nb_) if math.dist(pa,pb)>250 else None
        if path is None: pts=[pa,pb]
        else: pts=[pa]+path+[pb]
        ls=LineString(pts).simplify(2.0)
        length=ls.length
        legs.append({"from":a,"to":b,"mode":mode,"len":round(length),"pts":[[round(x,1),round(y,1)] for x,y in ls.coords]})
        print(C,di+1,a,b,mode,round(length),"snap",round(da),round(db),"ok" if path else "STRAIGHT")
    routes.append(legs)
# ---------- DEM ----------
dem=np.load(SC+f"dem_{C}.npy")
demq=np.clip(np.round(dem),-10,4000).astype(np.int16)
x0,y0=P(Rb[0],Rb[3]); x1,y1=P(Rb[2],Rb[1])
meta={"origin":S["origin"],"KX":KX,"KY":KY,"region":[x0,y0,x1,y1],
      "details":{k:list(DB[k].bounds) for k in DB},"dem":{"n":dem.shape[0]},
      "stops":{k:[round(c,1) for c in P(*v)] for k,v in S["stops"].items()},"stopsLL":S["stops"],"routes":routes}
blobs={}
for pool in feats:
    raw=encode(feats[pool]); blobs[pool]=raw
    print(C,pool,len(feats[pool]),"feats",len(raw),"bytes raw", len(zlib.compress(raw,9)),"z")
blobs["dem"]=demq.tobytes()
allb=b"".join(len(v).to_bytes(4,"little")+v for v in [blobs["region"],blobs["detail"],blobs["bld"],blobs["dem"]])
z=zlib.compress(allb,9)
print(C,"TOTAL z",len(z), "b64",len(base64.b64encode(z)))
open(f"data_{C}.b64","w").write(base64.b64encode(z).decode())
json.dump(meta,open(f"meta_{C}.json","w"),ensure_ascii=False)
