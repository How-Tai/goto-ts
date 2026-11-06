"""Policy and kernel-interface handling without touching live CPU settings."""
from pathlib import Path
import errno,importlib.util,json,tempfile
spec=importlib.util.spec_from_file_location('affinity',Path(__file__).with_name('kernel-affinity.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for bad in [[],[5,5,7],[7,5],[True,7],[5.0,7],[-1,7],[8],None,'7']:
 try:m.validate_cpus(bad,set(range(8)))
 except ValueError:pass
 else:raise AssertionError(bad)
assert m.parse_list('1-3,5,7')=={1,2,3,5,7}
checks=0
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);irq=root/'irq';irq.mkdir();global_mask=root/'workqueue';interrupts=root/'interrupts'
 for number in [0,19,21]:
  path=irq/str(number);path.mkdir();(path/'smp_affinity_list').write_text('0-7');(path/'effective_affinity_list').write_text('0')
 interrupts.write_text(' CPU0 CPU1 CPU2 CPU3 CPU4 CPU5 CPU6 CPU7\n'+'\n'.join(str(n)+': 0 0 0 0 0 0 0 0 IO-APIC device'+str(n) for n in [0,19,21]))
 (irq/'default_smp_affinity').write_text('ff');global_mask.write_text('ff')
 for count in range(1,8):
  cpus=list(range(count,8));r=m.apply(cpus,irq,global_mask,interrupts,set(range(8)))
  assert int(global_mask.read_text(),16)==sum(1<<cpu for cpu in cpus)
  assert m.parse_list((irq/'19/smp_affinity_list').read_text())==set(cpus)
  assert r['pendingIrqs']==[0,19,21] # fake hardware has not delivered a new IRQ
  checks+=1
 r=m.apply([4,6,7],irq,global_mask,interrupts,set(range(8)));assert r['serviceCpus']==[4,6,7];checks+=1
 original=Path.write_text
 def managed(path,*args,**kw):
  if path==irq/'0/smp_affinity_list':raise OSError(errno.EIO,'fixed interrupt')
  return original(path,*args,**kw)
 Path.write_text=managed
 try:
  r=m.apply([7],irq,global_mask,interrupts,set(range(8)));assert r['unmovableIrqs']==[0] and len(r['irqs'])==3;checks+=1
 finally:Path.write_text=original
print(json.dumps({'passed':True,'policyCases':checks,'invalidInputsRejected':9,'allCountsSupported':True,'retiringCpuHolesSupported':True,'fixedIrqsReported':True,'pendingHardwareRoutingReported':True}))

assert m.validate_cpus([0],{0}) == [0]
assert m.irq_descriptions(' CPU0 CPU1 CPU2\n19: 1 2 3 IO-APIC disk') == {'19':'IO-APIC disk'}
