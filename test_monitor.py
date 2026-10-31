import json
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import urllib.request
import urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer
from server import Collector, Pairing, handler_class
from host_metrics import MacMetrics, memory_from_vm, cpu_percent
from host_metrics_windows import WindowsMetrics

class TelemetryTests(unittest.TestCase):
    def test_mac_memory_history_is_bounded_and_preserves_failed_samples(self):
        metrics = MacMetrics.__new__(MacMetrics)
        metrics.previous, metrics.history, metrics.memory_history = None, [], []
        metrics.ticks = Mock(return_value=[10, 5, 80, 5])
        with patch('host_metrics.command', return_value='1000'), patch('host_metrics.memory_from_vm') as memory, patch('host_metrics.time.time', side_effect=range(100, 230, 5)):
            for i in range(25):
                memory.return_value = {'totalBytes': 1000, 'usedBytes': 400 + i}
                value = metrics.sample()
            self.assertEqual(len(value['memoryHistory']), 24)
            self.assertEqual(value['memoryHistory'][0], {'at': 105, 'value': 40.1})
            self.assertEqual(value['memoryHistory'][-1], {'at': 220, 'value': 42.4})
            previous = value['memoryHistory']
            memory.side_effect = OSError('unavailable')
            failed = metrics.sample()
            self.assertIsNone(failed['memory'])
            self.assertIn('memory', failed['errors'])
            self.assertEqual(failed['memoryHistory'], previous)
            self.assertIsNot(failed['memoryHistory'], previous)

    def test_windows_memory_history_uses_physical_usage_and_skips_failures(self):
        metrics = WindowsMetrics.__new__(WindowsMetrics)
        metrics.previous, metrics.history, metrics.memory_history = None, [], []
        metrics.kernel32 = Mock()
        metrics.kernel32.GetSystemTimes.return_value = False
        def memory_read(pointer):
            pointer._obj.ullTotalPhys = 1000
            pointer._obj.ullAvailPhys = 250
            return True
        metrics.kernel32.GlobalMemoryStatusEx.side_effect = memory_read
        with patch('host_metrics_windows.time.time', side_effect=range(100, 230, 5)):
            for _ in range(25):
                value = metrics.sample()
            self.assertEqual(len(value['memoryHistory']), 24)
            self.assertEqual(value['memoryHistory'][-1], {'at': 220, 'value': 75})
            self.assertFalse(value['memory']['estimated'])
            metrics.kernel32.GlobalMemoryStatusEx.side_effect = lambda _: False
            failed = metrics.sample()
            self.assertIsNone(failed['memory'])
            self.assertEqual(failed['memoryHistory'], value['memoryHistory'])

    def test_cpu_uses_deltas_and_idle_index(self):
        self.assertIsNone(cpu_percent(None, [1,2,3,4]))
        self.assertEqual(cpu_percent([0,0,0,0], [10,5,80,5]),20)
        self.assertIsNone(cpu_percent([1,2,3,4], [1,2,3,4]))
        self.assertEqual(cpu_percent([0xffffffff,0,0,0], [0,0,1,0]),50)

    def test_memory_excludes_file_cache_and_counts_physical_compression(self):
        text='Mach Virtual Memory Statistics: (page size of 16384 bytes)\nAnonymous pages: 100.\nPages wired down: 20.\nPages occupied by compressor: 10.\nPages purgeable: 5.\nFile-backed pages: 90.\n'
        m=memory_from_vm(text,100000000)
        self.assertEqual(m['usedBytes'],125*16384)
        self.assertTrue(m['estimated'])
        with self.assertRaises(ValueError):memory_from_vm('',10)

class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.folder=Path(self.temp.name)
        self.path=self.folder/'preferences.json'
        self.c=Collector('unused',preferences_path=self.path)
        self.p=Pairing(self.folder/'auth')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler_class(self.c,self.p,'127.0.0.1',0))
        self.port=self.server.server_port
        self.server.RequestHandlerClass=handler_class(self.c,self.p,'127.0.0.1',self.port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def post(self,value,auth=True,origin=None):
        headers={'Content-Type':'application/json'}
        if auth:
            token,_=self.p.pair('local',self.p.code);headers['Cookie']='deck_session='+token
        if origin:headers['Origin']=origin
        req=urllib.request.Request(f'http://127.0.0.1:{self.port}/api/settings',data=json.dumps(value).encode(),headers=headers)
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:
            with e:return e.code,json.load(e)
    def test_auth_and_origin_restrictions(self):
        self.assertEqual(self.post({'pollSeconds':30},False)[0],401)
        self.assertEqual(self.post({'pollSeconds':30},origin='http://evil.example')[0],403)
    def test_exact_allowed_values_and_persistence(self):
        for v in [True,'30',0,1,15,45,3600,None]:self.assertEqual(self.post({'pollSeconds':v})[0],400)
        self.assertEqual(self.post({'pollSeconds':30,'other':1})[0],400)
        for v in [30,300,60]:
            self.assertEqual(self.post({'pollSeconds':v}),(200,{'pollSeconds':v}))
            self.assertEqual(self.c.snapshot()['pollSeconds'],v)
            self.assertEqual(Collector('unused',preferences_path=self.path).interval,v)
            self.assertTrue(self.c.wake.is_set());self.c.wake.clear()
        self.assertEqual(self.path.stat().st_mode&0o777,0o600)
