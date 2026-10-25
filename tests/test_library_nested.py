"""Folder hierarchy ownership and movement regression checks."""
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import accounts
import library


class NestedFolders(unittest.TestCase):
    def test_nested_moves_and_ownership(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = accounts.Accounts(pathlib.Path(tmp) / 'accounts.db')
            user = store.user_for(store.register('owner@example.com', 'password-for-tests'))
            other = store.user_for(store.register('other@example.com', 'password-for-tests'))
            lib = library.Library(store, tmp)
            parent = lib.make_folder(user, 'Parent')
            child = lib.make_folder(user, 'Child', parent)
            destination = lib.make_folder(user, 'Destination')
            lib.move_folder(user, parent, destination)
            rows = {f['id']: f for f in lib.folders(user)}
            self.assertEqual(rows[parent]['parent'], destination)
            self.assertEqual(rows[child]['parent'], parent)
            with self.assertRaises(accounts.AccountError):
                lib.move_folder(user, parent, child)
            with self.assertRaises(accounts.AccountError):
                lib.make_folder(other, 'Forbidden', parent)
            with self.assertRaises(accounts.AccountError):
                lib.move_folder(other, parent)
            lib.move_folder(user, parent)
            lib.delete_folder(user, parent)
            rows = {f['id']: f for f in lib.folders(user)}
            self.assertIsNone(rows[child]['parent'])


if __name__ == '__main__':
    unittest.main()
