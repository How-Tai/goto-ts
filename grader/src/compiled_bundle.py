"""Bounded manifest + raw-file bundle; no pickle or general archive extraction."""
from pathlib import Path, PurePosixPath
import hashlib,json,os,stat,struct
from grader_safety import SandboxHealthError

MAGIC=b'OTOGCF2\n'
MAX_MANIFEST=4*1024**2
MAX_DATA=256*1024**2
MAX_BUNDLE=272*1024**2
MAX_ENTRIES=4096


def _path(name):
    if not isinstance(name,str) or not name or '\0' in name:
        raise ValueError('Invalid bundle path.')
    p=PurePosixPath(name)
    if p.is_absolute() or any(x in ('','.','..') for x in name.split('/')):
        raise ValueError('Bundle path escapes its sandbox.')
    return p


def write(directory,destination):
    root=Path(directory);entries=[];data=0
    for folder,dirs,files in os.walk(root,followlinks=False):
        for name in sorted(dirs+files):
            p=Path(folder)/name;info=p.lstat();relative=p.relative_to(root).as_posix();_path(relative)
            entry={'name':relative,'mode':stat.S_IMODE(info.st_mode)&0o777,
                   'rootUid':info.st_uid==0,'rootGid':info.st_gid==0}
            if stat.S_ISDIR(info.st_mode):entry['type']='dir'
            elif stat.S_ISLNK(info.st_mode):entry.update(type='link',target=os.readlink(p))
            elif stat.S_ISREG(info.st_mode):
                entry.update(type='file',size=info.st_size);data+=info.st_size
            else:raise ValueError('Unsupported compiler output type.')
            entries.append(entry)
            if len(entries)>MAX_ENTRIES or data>MAX_DATA:raise ValueError('Compiled tree exceeds bundle limit.')
    manifest=json.dumps(entries,ensure_ascii=True,separators=(',',':')).encode()
    if len(manifest)>MAX_MANIFEST:raise ValueError('Compiled manifest exceeds limit.')
    digest=hashlib.sha256();size=0
    with Path(destination).open('xb') as out:
        def emit(raw):
            nonlocal size
            size+=len(raw)
            if size>MAX_BUNDLE:raise ValueError('Compiled bundle exceeds limit.')
            digest.update(raw);out.write(raw)
        emit(MAGIC+struct.pack('!I',len(manifest))+manifest)
        for e in entries:
            if e['type']!='file':continue
            fd=os.open(root/e['name'],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            with os.fdopen(fd,'rb') as inp:
                info=os.fstat(inp.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size!=e['size']:raise ValueError('Compiled file changed.')
                left=e['size']
                while left:
                    chunk=inp.read(min(65536,left))
                    if not chunk:raise ValueError('Truncated compiled file.')
                    emit(chunk);left-=len(chunk)
                if inp.read(1):raise ValueError('Compiled file grew.')
    return size,digest.hexdigest()


def restore(source,box,expected_size,expected_digest,remove_box):
    fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as inp:
        info=os.fstat(inp.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size!=expected_size or not 12<=info.st_size<=MAX_BUNDLE:
            raise ValueError('Invalid bundle file.')
        digest=hashlib.sha256();consumed=0
        def take(n):
            nonlocal consumed
            if n<0 or consumed+n>expected_size:raise ValueError('Bundle length exceeds its file.')
            raw=inp.read(n)
            if len(raw)!=n:raise ValueError('Truncated bundle.')
            consumed+=n;digest.update(raw);return raw
        if take(8)!=MAGIC:raise ValueError('Invalid bundle format.')
        length=struct.unpack('!I',take(4))[0]
        if not 0<length<=MAX_MANIFEST:raise ValueError('Invalid manifest length.')
        entries=json.loads(take(length))
        if not isinstance(entries,list) or len(entries)>MAX_ENTRIES:raise ValueError('Invalid manifest entries.')
        names={};data=0
        for e in entries:
            if not isinstance(e,dict):raise ValueError('Invalid manifest entry.')
            p=_path(e.get('name'));name=p.as_posix()
            if name in names:raise ValueError('Duplicate bundle path.')
            if type(e.get('mode')) is not int or not 0<=e['mode']<=0o777:raise ValueError('Invalid mode.')
            if type(e.get('rootUid')) is not bool or type(e.get('rootGid')) is not bool:raise ValueError('Invalid owner class.')
            kind=e.get('type')
            if kind=='file':
                if type(e.get('size')) is not int or not 0<=e['size']<=MAX_DATA:raise ValueError('Invalid file size.')
                data+=e['size']
            elif kind=='link':
                if not isinstance(e.get('target'),str) or '\0' in e['target'] or len(os.fsencode(e['target']))>4096:raise ValueError('Invalid symlink target.')
            elif kind!='dir':raise ValueError('Unsupported bundle entry type.')
            names[name]=e
        if data>MAX_DATA or consumed+data!=expected_size:raise ValueError('Invalid bundle data length.')
        for name in names:
            for parent in PurePosixPath(name).parents:
                if str(parent)=='.':break
                if str(parent) not in names or names[str(parent)]['type']!='dir':raise ValueError('Bundle parent is not a directory.')
        owner=Path(box).stat();remove_box(box)
        Path(box).mkdir(mode=0o700)
        # Only empty directories/regular files are created while writing data.
        # Symlinks are created last, so no root write ever traverses one.
        for e in sorted(entries,key=lambda e:len(PurePosixPath(e['name']).parts)):
            if e['type']=='dir':(Path(box)/e['name']).mkdir(mode=0o700)
        for e in entries:
            if e['type']!='file':continue
            p=Path(box)/e['name']
            with p.open('xb') as out:
                left=e['size']
                while left:
                    chunk=take(min(65536,left));out.write(chunk);left-=len(chunk)
        if consumed!=expected_size or inp.read(1) or digest.hexdigest()!=expected_digest:
            raise ValueError('Compiled bundle checksum changed.')
        for e in entries:
            p=Path(box)/e['name']
            if e['type']=='link':p.symlink_to(e['target'])
        for e in sorted(entries,key=lambda e:-len(PurePosixPath(e['name']).parts)):
            p=Path(box)/e['name']
            os.chown(p,0 if e['rootUid'] else owner.st_uid,0 if e['rootGid'] else owner.st_gid,follow_symlinks=False)
            if e['type']!='link':p.chmod(e['mode'])
        os.chown(box,owner.st_uid,owner.st_gid);Path(box).chmod(stat.S_IMODE(owner.st_mode))
