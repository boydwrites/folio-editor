"""One-time migration and local startup recovery, using synthetic files only."""
import errno
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import PrivateStore
from launch import connect_or_start

class RecoveryTests(unittest.TestCase):
    def test_migration_saves_exact_backup_and_preserves_versions_examples_and_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            store=PrivateStore(directory)
            old={'sessions':[{'id':'one','draft':'Accepted','proposal':{'text':'Visible suggestion'},'source':'Original','status':'final','versions':[],'history':[]}], 'examples':[{'text':'Synthetic sample'}], 'settings':{'voice':'Synthetic preference'}}
            store.save(old); original=store.path.read_bytes()
            updated=store.load(migrate=True)
            backups=list(Path(directory).glob('recovery-v1-*.json'))
            self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_bytes(),original)
            self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode),0o600)
            doc=updated['sessions'][0]
            self.assertEqual(doc['draft'],'Visible suggestion')
            self.assertEqual([v['text'] for v in doc['versions']],['Accepted','Visible suggestion'])
            self.assertEqual(doc['source'],'Original');self.assertEqual(doc['status'],'final')
            self.assertEqual(updated['examples'],old['examples'])
            self.assertEqual(updated['settings']['voice'],old['settings']['voice'])
            self.assertNotIn('proposal',doc)
            self.assertEqual(store.load(migrate=True),updated)
            self.assertEqual(len(list(Path(directory).glob('recovery-v1-*.json'))),1)
    def test_original_only_document_becomes_editable_draft_without_losing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            store=PrivateStore(directory)
            store.save({'sessions':[{'id':'one','source':'Original only'}], 'examples':[], 'settings':{}})
            doc=store.load(migrate=True)['sessions'][0]
            self.assertEqual(doc['source'],doc['draft'])
    @patch('launch.urllib.request.build_opener')
    @patch('launch.FolioServer')
    def test_default_port_conflict_tries_next_port(self,server,opener):
        opener.return_value.open.side_effect=OSError('not Folio')
        expected=object();server.side_effect=[OSError(errno.EADDRINUSE,'occupied'),expected]
        self.assertEqual(connect_or_start(),(expected,8766))
        self.assertEqual(server.call_args.args[0],('127.0.0.1',8766))
    @patch('launch.urllib.request.build_opener')
    @patch('launch.FolioServer')
    def test_explicit_port_never_silently_changes(self,server,opener):
        opener.return_value.open.side_effect=OSError('not Folio')
        server.side_effect=OSError(errno.EADDRINUSE,'occupied')
        with self.assertRaises(OSError):connect_or_start(8800)
        server.assert_called_once()
    @patch('launch.urllib.request.build_opener')
    @patch('launch.FolioServer')
    def test_existing_folio_is_reused(self,server,opener):
        opener.return_value.open.return_value.__enter__.return_value.read.return_value=b'{"app":"Folio"}'
        self.assertEqual(connect_or_start(),(None,8765));server.assert_not_called()
