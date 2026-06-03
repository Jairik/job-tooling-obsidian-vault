// A dropdown directory browser for picking a path inside the vault. The directory
// tree is fetched lazily on first open and cached in state. When `allowNewFile` is
// set it also exposes a filename input and composes the final value as
// "<dir>/<filename>"; otherwise it just emits the chosen directory.
import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

interface VaultPathPickerProps {
  vaultDir: string;
  value: string;
  onChange: (path: string) => void;
  allowNewFile?: boolean;
  placeholder?: string;
}

export function VaultPathPicker({ vaultDir, value, onChange, allowNewFile, placeholder = "Select a directory..." }: VaultPathPickerProps) {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [newFile, setNewFile] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // The directory portion of `value`; with allowNewFile, `newFile` holds the rest.
  const [selectedDir, setSelectedDir] = useState("");

  // Keep the internal dir/filename split in sync with the incoming value. With
  // allowNewFile a trailing-".md" value (no slash) is treated as a bare filename
  // at the vault root, anything else as a directory.
  useEffect(() => {
    if (value) {
      if (allowNewFile) {
        const lastSlash = value.lastIndexOf("/");
        if (lastSlash !== -1) {
          setSelectedDir(value.substring(0, lastSlash));
          setNewFile(value.substring(lastSlash + 1));
        } else if (value.endsWith(".md")) {
          setSelectedDir("");
          setNewFile(value);
        } else {
          setSelectedDir(value);
          setNewFile("");
        }
      } else {
        setSelectedDir(value);
      }
    }
  }, [value, allowNewFile]);

  // Fetch the vault directory tree the first time the dropdown is opened.
  useEffect(() => {
    if (open && tree.length === 0) {
      setLoading(true);
      api.vaultTree(vaultDir)
        .then(setTree)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [open, vaultDir, tree.length]);

  // Close the dropdown when clicking anywhere outside it.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSelect = (dirPath: string) => {
    setSelectedDir(dirPath);
    if (allowNewFile) {
      onChange(dirPath ? `${dirPath}/${newFile}` : newFile);
    } else {
      onChange(dirPath);
      setOpen(false);
    }
  };

  const handleNewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.value;
    setNewFile(file);
    onChange(selectedDir ? `${selectedDir}/${file}` : file);
  };

  // The tree is always fully expanded (no per-node collapse state); filtering just
  // hides non-matching branches. A node survives the filter if it matches, or if a
  // child/grandchild matches — so a deep match keeps its ancestors visible.
  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map(node => {
      const match = node.name.toLowerCase().includes(filter.toLowerCase());
      const hasChildren = node.children && node.children.length > 0;
      const childMatches = hasChildren && node.children!.some(c => c.name.toLowerCase().includes(filter.toLowerCase()) || (c.children && c.children.some(cc => cc.name.toLowerCase().includes(filter.toLowerCase()))));

      if (filter && !match && !childMatches) return null;

      return (
        <div key={node.path} className="vault-picker-node" style={{ paddingLeft: depth * 12 }}>
          <div
            className={`vault-picker-node-content ${selectedDir === node.path ? "selected" : ""}`}
            onClick={() => handleSelect(node.path)}
          >
            <span className="vault-picker-icon">📁</span>
            <span className="vault-picker-name">{node.name}</span>
          </div>
          {hasChildren && (
            <div className="vault-picker-children">
              {renderTree(node.children!, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="vault-picker-wrap" ref={dropdownRef}>
      <button 
        className="vault-picker-trigger" 
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="vault-picker-icon">📁</span>
        <span className="vault-picker-breadcrumb">
          {selectedDir || placeholder}
        </span>
        <span className="vault-picker-chevron">▾</span>
      </button>

      {open && (
        <div className="vault-picker-dropdown">
          <div className="vault-picker-search">
            <input 
              type="text" 
              placeholder="Filter directories..." 
              value={filter}
              onChange={e => setFilter(e.target.value)}
              autoFocus
            />
          </div>
          <div className="vault-picker-tree">
            {loading ? (
              <div className="vault-picker-loading">Loading...</div>
            ) : tree.length === 0 ? (
              <div className="vault-picker-empty">No directories found</div>
            ) : (
              <>
                <div 
                  className={`vault-picker-node-content ${selectedDir === "" ? "selected" : ""}`}
                  onClick={() => handleSelect("")}
                >
                  <span className="vault-picker-icon">🏠</span>
                  <span className="vault-picker-name">Vault Root</span>
                </div>
                {renderTree(tree)}
              </>
            )}
          </div>
          {allowNewFile && (
            <div className="vault-picker-newfile">
              <span className="vault-picker-newfile-prefix">{selectedDir ? `${selectedDir}/` : ""}</span>
              <input 
                type="text" 
                placeholder="filename.md" 
                value={newFile}
                onChange={handleNewFileChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
