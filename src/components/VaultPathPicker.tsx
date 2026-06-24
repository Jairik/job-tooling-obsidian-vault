// A dropdown directory browser for picking a path inside the vault. The directory
// tree is fetched lazily on first open and cached in state. When `allowNewFile` is
// set it also exposes a filename input and composes the final value as
// "<dir>/<filename>"; otherwise it just emits the chosen directory.
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";

const FolderIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
const HomeIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const ChevronIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

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

interface DropdownPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/* Browses the server-provided vault tree and returns a selected directory or file path. */
export function VaultPathPicker({ vaultDir, value, onChange, allowNewFile, placeholder = "Select a directory..." }: VaultPathPickerProps) {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [newFile, setNewFile] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({
    left: 0,
    width: 0,
    maxHeight: 0,
  });

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

  // Render the menu at the document root so the card and settings-panel scroll
  // containers cannot crop it. Keep it aligned with the trigger and flip above
  // the trigger when that gives the menu more room.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const viewportPadding = 12;
      const gap = 4;
      const preferredHeight = allowNewFile ? 350 : 306;
      const spaceAbove = rect.top - gap - viewportPadding;
      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const openUpward = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(0, openUpward ? spaceAbove : spaceBelow);
      const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);

      setDropdownPosition({
        left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding)),
        width,
        maxHeight: availableHeight,
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    // Capture nested scrolling (such as the settings dialog's content pane),
    // not just document scrolling.
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, allowNewFile]);

  // Close the dropdown when clicking anywhere outside it.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (!pickerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
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
            <span className="vault-picker-icon">{FolderIcon}</span>
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
    <div className="vault-picker-wrap" ref={pickerRef}>
      <button 
        ref={triggerRef}
        className="vault-picker-trigger" 
        onClick={() => setOpen(!open)}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="vault-picker-icon">{FolderIcon}</span>
        <span className="vault-picker-breadcrumb">
          {selectedDir || placeholder}
        </span>
        <span className="vault-picker-chevron">{ChevronIcon}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="vault-picker-dropdown"
            role="listbox"
            style={dropdownPosition}
          >
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
                    <span className="vault-picker-icon">{HomeIcon}</span>
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
          </div>,
          document.body
        )}
    </div>
  );
}
