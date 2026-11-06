import unittest
from unittest.mock import patch
from monitor_agent import cpu_point, memory_point, Collector, parse_units, unavailable, cgroup_cpu_sample

class Metrics(unittest.TestCase):
    def test_cpu_counters_discount_idle_and_do_not_double_count_guest(self):
        before=[0]*10
        after=[20,0,10,60,5,2,3,0,7,0]
        self.assertEqual(cpu_point(before,after),{'cpuUser':20.0,'cpuSystem':15.0,'cpuWait':5.0})
        self.assertEqual(cpu_point(None,after)['cpuUser'],None)

    def test_memory_segments_and_swap(self):
        point=memory_point({'MemTotal':1000,'MemFree':200,'Cached':300,'Buffers':50,
                            'SReclaimable':30,'Shmem':10,'SwapTotal':500,'SwapFree':400})
        self.assertEqual(point['memoryUsedMb']+point['memoryCacheMb']+point['memoryBuffersMb'],800)
        self.assertEqual(point['swapUsedMb'],100)

    def test_history_is_bounded_and_restart_resets_cpu_baseline(self):
        collector=Collector()
        for i in range(1000): collector.history.append({'at':i})
        self.assertEqual(len(collector.history),120)
        self.assertIsNone(collector.cpu_usage(('worker',1),2,1))
        self.assertEqual(collector.cpu_usage(('worker',1),2.5,2),50)
        self.assertIsNone(collector.cpu_usage(('worker',2),0,3))

    def test_batched_unit_records_and_unknown_metrics(self):
        units=parse_units('Id=otog-api.service\nMainPID=100\nActiveState=active\n\nId=otog-web.service\nMainPID=200\nActiveState=active\n')
        self.assertEqual(units['otog-api.service']['MainPID'],'100')
        self.assertEqual(units['otog-web.service']['MainPID'],'200')
        self.assertIsNone(unavailable('otog-api.service')['cpuPercent'])

    def test_container_cpu_uses_elapsed_time_and_allows_multiple_cpus(self):
        collector=Collector()
        key=('grader','start')
        self.assertIsNone(collector.container_cpu_usage(key,1,10))
        self.assertEqual(collector.container_cpu_usage(key,6,15),100)
        self.assertEqual(collector.container_cpu_usage(key,16,20),200,
                         'Do not mask valid multi-CPU usage by clamping to 100%')
        self.assertIsNone(collector.container_cpu_usage(('grader','new-start'),0,20))

    def test_invalid_or_reset_counters_are_not_reported_as_usage(self):
        collector=Collector();key=('grader','start')
        collector.container_cpu_usage(key,100,10)
        self.assertIsNone(collector.container_cpu_usage(key,50,20))
        self.assertIsNone(collector.container_cpu_usage(key,100,20))
        self.assertIsNone(collector.container_cpu_usage(key,None,None))
        self.assertIsNone(collector.container_cpu_usage(key,200,30))
        self.assertEqual(collector.container_cpu_usage(key,201,31),100)
        collector.cpu_usage(('api',1),5,10)
        self.assertIsNone(collector.cpu_usage(('api',1),1,20))

    def test_cgroup_counter_includes_children_and_has_own_read_timestamp(self):
        def read(path):
            return '0::/system.slice/docker-123.scope\n' if path.name=='cgroup' else 'usage_usec 21240000\nuser_usec 20000000\nsystem_usec 1240000\n'
        with patch('monitor_agent.Path.read_text',read),patch('monitor_agent.time.monotonic',side_effect=[10,10.002]):
            seconds,at=cgroup_cpu_sample(123)
            self.assertEqual(seconds,21.24)
            self.assertAlmostEqual(at,10.001)
        with patch('monitor_agent.Path.read_text',side_effect=FileNotFoundError):
            self.assertEqual(cgroup_cpu_sample(123),(None,None))

    def test_unit_cpu_uses_process_read_timestamp(self):
        collector=Collector()
        fields={'MainPID':'123','ActiveState':'active','ExecMainStartTimestampMonotonic':'1000000'}
        process={'cpuSeconds':2,'startedTicks':10,'threads':1,'memoryMb':1,'virtualMb':1,'sampledAt':10}
        with patch('monitor_agent.process_info',return_value=process):
            self.assertIsNone(collector.unit('otog-api.service',20,fields)['cpuPercent'])
            process.update(cpuSeconds=7,sampledAt=20)
            self.assertEqual(collector.unit('otog-api.service',1000,fields)['cpuPercent'],50)

    def test_container_call_delays_do_not_affect_cpu_percentage(self):
        collector=Collector();collector.docker_version='1.0'
        inspected={'State':{'Pid':123,'StartedAt':'2026-10-11T00:00:00Z','Running':True},'HostConfig':{},'RestartCount':0}
        stats={'cpu_stats':{'cpu_usage':{'total_usage':1000},'system_cpu_usage':8000,'online_cpus':8}}
        def read(path):return stats if '/stats?' in path else inspected
        with patch('monitor_agent.docker_get',side_effect=read),patch('monitor_agent.process_info',return_value={'threads':1,'virtualMb':1}),patch('monitor_agent.cgroup_cpu_sample',side_effect=[(1,10),(6,15)]):
            self.assertIsNone(collector.container('grader')['cpuPercent'])
            # Guest aggregate ticks lag: Docker normalization would give 200%,
            # although the container consumed five CPU-seconds in five seconds.
            stats['cpu_stats']['cpu_usage']['total_usage']=5_000_001_000
            stats['cpu_stats']['system_cpu_usage']=20_000_008_000
            with patch('monitor_agent.time.monotonic',return_value=100000):
                self.assertEqual(collector.container('grader')['cpuPercent'],100)

if __name__=='__main__': unittest.main(verbosity=2)
