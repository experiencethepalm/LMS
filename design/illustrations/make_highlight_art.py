import math
G='#2F4A3A'; S='#B89B6A'; L='#C9BFAE'; F='#F3EEE6'
# ---------- 1. One address, two roads (isometric) ----------
c30=math.cos(math.radians(30)); s30=0.5
sc=4.6; OX=450; OY=330
def P(x,y,z=0): return (OX+(x-y)*c30*sc, OY+(x+y)*s30*sc - z*sc)
def poly(pts,**a):
    d=' '.join(f'{x:.1f},{y:.1f}' for x,y in pts)
    attrs=' '.join(f'{k.replace("_","-")}="{v}"' for k,v in a.items())
    return f'<polygon points="{d}" {attrs}/>'
def line(p,q,**a):
    attrs=' '.join(f'{k.replace("_","-")}="{v}"' for k,v in a.items())
    return f'<line x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]:.1f}" {attrs}/>'
el=[]
R=62; W1=36; W2=24
# plot in x,y in [-48,0]; road 1 (36 m) at y in [0,W1] running along x; road 2 (24 m) at x in [0,W2] running along y
E=W2+26  # how far road 1 extends past the crossing
for yy in (0,W1):
    el.append(line(P(-R,yy),P(0,yy),stroke=G,stroke_width=2.56))
    el.append(line(P(W2,yy),P(E,yy),stroke=G,stroke_width=2.56))
for xx in (0,W2):
    el.append(line(P(xx,-R),P(xx,0),stroke=G,stroke_width=2.56))
    el.append(line(P(xx,W1),P(xx,W1+26),stroke=G,stroke_width=2.56))
el.append(line(P(-R,W1/2),P(E,W1/2),stroke=S,stroke_width=2.24,stroke_dasharray='7 7'))
el.append(line(P(W2/2,-R),P(W2/2,W1+26),stroke=S,stroke_width=2.24,stroke_dasharray='7 7'))
# plot
el.append(poly([P(-48,-48),P(0,-48),P(0,0),P(-48,0)],fill=F,stroke=L,stroke_width=1.92))
# tower box set back on the plot
x0,y0,bw,bd,H=-36,-36,26,26,74
X1,Y1=x0+bw,y0+bd
top=[P(x0,y0,H),P(X1,y0,H),P(X1,Y1,H),P(x0,Y1,H)]
faceA=[P(x0,Y1,0),P(X1,Y1,0),P(X1,Y1,H),P(x0,Y1,H)]   # faces road 1 (front-left)
faceB=[P(X1,y0,0),P(X1,Y1,0),P(X1,Y1,H),P(X1,y0,H)]   # faces road 2 (front-right)
el.append(poly(faceA,fill='#FFFFFF',stroke=G,stroke_width=2.88,stroke_linejoin='round'))
el.append(poly(faceB,fill='#FBF8F3',stroke=G,stroke_width=2.88,stroke_linejoin='round'))
el.append(poly(top,fill=F,stroke=G,stroke_width=2.88,stroke_linejoin='round'))
for k in range(1,20):
    z=H*k/20
    el.append(line(P(x0,Y1,z),P(X1,Y1,z),stroke=G,stroke_width=0.96,opacity=0.5))
    el.append(line(P(X1,y0,z),P(X1,Y1,z),stroke=G,stroke_width=0.96,opacity=0.5))
for t in (0.34,0.66):
    el.append(line(P(x0+bw*t,Y1,0),P(x0+bw*t,Y1,H),stroke=G,stroke_width=1.44,opacity=0.75))
    el.append(line(P(X1,y0+bd*t,0),P(X1,y0+bd*t,H),stroke=G,stroke_width=1.44,opacity=0.75))
for (u,v) in [(4,4),(bw-4,4),(4,bd-4),(bw-4,bd-4)]:
    cx,cy=P(x0+u,y0+v,H); el.append(f'<circle cx="{cx:.1f}" cy="{cy-3:.1f}" r="4.5" fill="none" stroke="{S}" stroke-width="2.2"/>')
# entry forecourt arc + gate marks toward the corner
# dimension marks across each road
def dim(p,q,label,offset):
    el.append(line(p,q,stroke=G,stroke_width=1.92))
    for e in (p,q): el.append(f'<circle cx="{e[0]:.1f}" cy="{e[1]:.1f}" r="4.5" fill="{G}"/>')
    mx,my=(p[0]+q[0])/2+offset[0],(p[1]+q[1])/2+offset[1]
    el.append(f'<rect x="{mx-62:.1f}" y="{my-25:.1f}" width="124" height="50" rx="25" fill="#FFFFFF" stroke="{S}" stroke-width="2.4"/>')
    el.append(f'<text x="{mx:.1f}" y="{my+10:.1f}" text-anchor="middle" font-family="Inter, sans-serif" font-size="29" font-weight="600" fill="{G}">{label}</text>')
dim(P(-R+8,0),P(-R+8,W1),'36 m',(0,0))
dim(P(0,-R+8),P(W2,-R+8),'24 m',(0,0))
import re as _re
_nums=[(float(a),float(b)) for a,b in _re.findall(r'(-?\d+\.?\d*),(-?\d+\.?\d*)',' '.join(el))]
_nums+=[(float(a),float(b)) for a,b in _re.findall(r'x1="(-?[\d.]+)" y1="(-?[\d.]+)"',' '.join(el))]
_nums+=[(float(a),float(b)) for a,b in _re.findall(r'x2="(-?[\d.]+)" y2="(-?[\d.]+)"',' '.join(el))]
mnx=min(x for x,_ in _nums)-20; mxx=max(x for x,_ in _nums)+20; mny=min(y for _,y in _nums)-30; mxy=max(y for _,y in _nums)+20
VW,VH=mxx-mnx,mxy-mny
svg1=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{mnx:.0f} {mny:.0f} {VW:.0f} {VH:.0f}" width="{VW:.0f}" height="{VH:.0f}">{"".join(el)}</svg>'
open('/home/claude/illus/one-address-two-roads.svg','w').write(svg1)

# ---------- 2. Two doors, one home (front elevation) ----------
e=[]
def r(x,y,w,h,**a):
    attrs=' '.join(f'{k.replace("_","-")}="{v}"' for k,v in a.items()); return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" {attrs}/>'
def l(x1,y1,x2,y2,**a):
    attrs=' '.join(f'{k.replace("_","-")}="{v}"' for k,v in a.items()); return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {attrs}/>'
FL=430
e.append(l(40,FL,820,FL,stroke=G,stroke_width=3.20))

# floor tiles hint
for x in range(100,820,120): e.append(l(x,FL,x-30,FL+40,stroke=L,stroke_width=1.60))
# service entry (left, narrower, plain)
e.append(r(110,190,92,240,fill='#FFFFFF',stroke=G,stroke_width=3.20))
e.append(l(186,312,186,326,stroke=G,stroke_width=3.84,stroke_linecap='round'))
# main entrance (wider, grooved)
e.append(r(270,160,128,270,fill='#FFFFFF',stroke=G,stroke_width=3.52))
e.append(r(262,152,144,278,fill='none',stroke=G,stroke_width=1.92))
for y in range(190,420,26): e.append(l(286,y,382,y,stroke=S,stroke_width=1.92))
e.append(l(378,300,378,326,stroke=G,stroke_width=4.16,stroke_linecap='round'))
# lift (one pair)
e.append(r(458,180,104,250,fill=F,stroke=G,stroke_width=2.56))
e.append(l(510,180,510,430,stroke=G,stroke_width=1.92))
e.append(r(574,292,9,20,rx=2,fill='none',stroke=G,stroke_width=1.92))
# bench
e.append(r(604,390,76,18,rx=3,fill='#FFFFFF',stroke=G,stroke_width=2.56))
e.append(l(614,408,614,430,stroke=G,stroke_width=2.56)); e.append(l(670,408,670,430,stroke=G,stroke_width=2.56))
# julla (hanging swing)
for x in (712,800): e.append(l(x,70,x,322,stroke=G,stroke_width=2.24,stroke_dasharray='1 6',stroke_linecap='round'))
e.append(f'<path d="M700 352 h112 M704 352 v-46 h104 v46" fill="none" stroke="{G}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>')
e.append(r(700,352,112,14,rx=3,fill='#FFFFFF',stroke=G,stroke_width=2.88))
for x in range(722,806,18): e.append(l(x,310,x,350,stroke=G,stroke_width=1.60))
# plant
e.append(f'<path d="M420 430 v-34 h34 v34" fill="#FFFFFF" stroke="{G}" stroke-width="1.6"/>')
e.append(f'<path d="M437 396 C430 370 414 362 404 360 M437 396 C440 368 452 354 466 350 M437 396 C437 376 437 362 438 344" fill="none" stroke="{S}" stroke-width="1.6" stroke-linecap="round"/>')
# labels with leader lines
def tag(x,y,tx,ty,text,anchor='middle'):
    e.append(l(x,y,tx,ty+22,stroke=S,stroke_width=2.08))
    e.append(f'<circle cx="{x}" cy="{y}" r="5.5" fill="{S}"/>')
    w=len(text)*14.6+36
    bx=tx-w/2 if anchor=='middle' else tx
    e.append(f'<rect x="{bx:.0f}" y="{ty-24}" width="{w:.0f}" height="46" rx="23" fill="#FFFFFF" stroke="{S}" stroke-width="2.2"/>')
    e.append(f'<text x="{bx+w/2:.0f}" y="{ty+8}" text-anchor="middle" font-family="Inter, sans-serif" font-size="20" font-weight="600" letter-spacing="1.2" fill="{G}">{text}</text>')
tag(156,250,150,122,'SERVICE')
tag(334,214,352,122,'MAIN DOOR')
svg2=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="30 88 810 372" width="810" height="372">{"".join(e)}</svg>'
open('/home/claude/illus/two-doors-one-home.svg','w').write(svg2)
print('svgs ok')
