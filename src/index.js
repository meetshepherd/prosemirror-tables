// This file defines a plugin that handles the drawing of cell
// selections and the basic user interactions for creating and working
// with such selections. It also makes sure that, after each
// transaction, the shapes of tables are normalized to be rectangular
// and not contain overlapping cells.

import {AllSelection, Plugin, Selection} from "prosemirror-state"

import {handleTripleClick, handleKeyDown, handlePaste, handleMouseDown, preventCTX} from "./input"
import {key as tableEditingKey, isHeadInsideTable, closestCell, closestParent, DefaultCellContent} from "./util"
import {drawCellSelection, normalizeSelection, CellSelection} from "./cellselection"
import {fixTables, fixTablesKey} from "./fixtables"

const sameRect = (r1, r2) => {
  return r1.x === r2.x && r1.y === r2.y && r1.width === r2.width && r1.height === r2.height
};

// :: () → Plugin
//
// Creates a [plugin](http://prosemirror.net/docs/ref/#state.Plugin)
// that, when added to an editor, enables cell-selection, handles
// cell-based copy/paste, and makes sure tables stay well-formed (each
// row has the same width, and cells don't overlap).
//
// You should probably put this plugin near the end of your array of
// plugins, since it handles mouse and arrow key events in tables
// rather broadly, and other plugins, like the gap cursor or the
// column-width dragging plugin, might want to get a turn first to
// perform more specific behavior.
export function tableEditing({
  allowTableNodeSelection = false,
  callbacks = {
    selectionChangedOnTable: (rects) => {},
    contextMenuOnCell: (rect) => {},
  },
  cellContentFill = () => undefined,
} = {}) {
  DefaultCellContent.node = cellContentFill;
  return new Plugin({
    key: tableEditingKey,

    // This piece of state is used to remember when a mouse-drag
    // cell-selection is happening, so that it can continue even as
    // transactions (which might move its anchor cell) come in.
    state: {
      init() { return null },
      apply(tr, cur) {
        let set = tr.getMeta(tableEditingKey)
        if (set != null) return set == -1 ? null : set
        if (cur == null || !tr.docChanged) return cur
        let {deleted, pos} = tr.mapping.mapResult(cur)
        return deleted ? null : pos
      }
    },
    view: (editorView) => ({
      update: (view, prevState) => {
        const { state } = view;
        const { selection } = state;
        if (selection instanceof AllSelection) {
          callbacks.selectionChangedOnTable(undefined);
          return;
        }
        const { selection: prevSelection } = prevState;
        // if the head position is changed
        if (Math.abs(selection.$head.pos - prevSelection.$head.pos) > 1) {
          // if the new head is inside a table
          if (isHeadInsideTable(selection.$head)) {
            const cell = closestCell(selection.$head);
            const domCell = view.domAtPos(cell.start).node;
            const domTable = domCell.parentNode.parentNode;
            // if old cursor is inside a table, we need to check the table bounding rects
            if (isHeadInsideTable(prevSelection.$head)) {
              const oldCell = closestCell(prevSelection.$head);
              // const oldTable = closestParent(prevSelection.$head, (node) => node.type.spec.tableRole === 'table');
              // const table = closestParent(prevSelection.$head, (node) => node.type.spec.tableRole === 'table');
              const oldDomCell = view.domAtPos(oldCell.start).node;
              const oldDomTable = oldDomCell.parentNode.parentNode;
              // if the table is identical, check its bounding rects
              if (oldDomTable === domTable) {
                const oldRect = oldDomTable.getBoundingClientRect();
                const rect = domTable.getBoundingClientRect();
                // if the table cell is moved in any direction
                // console.debug('here', cell, oldCell);
                // console.debug('here', table, oldTable);
                if (!sameRect(oldRect, rect)) {
                  callbacks.selectionChangedOnTable({
                    cellRect: domCell.getBoundingClientRect(),
                    tableRect: rect,
                  });
                  return;
                } else {
                  // otherwise noting to update, just table wide updates cause problems
                  return;
                }
              }
              // otherwise fallback to the default behavior, update(), the tables are different
            }
            // if the old head is not part of a table, we sure need to update
            callbacks.selectionChangedOnTable({
              cellRect: domCell.getBoundingClientRect(),
              tableRect: domTable.getBoundingClientRect(),
            });
            return;
          } else {
            callbacks.selectionChangedOnTable(undefined);
          }
        }
      },
      destroy: () => {
        callbacks.selectionChangedOnTable(undefined);
      },
    }),
    props: {
      decorations: drawCellSelection,

      handleDOMEvents: {
        mousedown: (view, event) => handleMouseDown(view, event, callbacks),
        mouseup: (view, event) => preventCTX(view, event, callbacks),
        handleKeyDown,
        contextmenu: (view, event) => {
          const head = view.state.selection.$head;
          if (isHeadInsideTable(head)) {
            // It is handled on handle click on
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return true;
          }
          return false;
        },
      },

      createSelectionBetween(view, anchor, head) {
        // if (view.state.selection instanceof CellSelection) return undefined;

        const currentResolvedPos = view.state.selection.$head.pos;
        const nextResolvedPos = head.pos;
        if (Math.abs(currentResolvedPos - nextResolvedPos) > 1) {
          // captures most normal events and reduces the execution of this significantly
          const inTable = isHeadInsideTable(head);
          if (inTable) {
            const cell = closestCell(head);
            if (!cell) return;
            const domCell = view.domAtPos(cell.start).node;
            const domTable = domCell.parentNode.parentNode;
            callbacks.selectionChangedOnTable({
              cellRect: domCell.getBoundingClientRect(),
              tableRect: domTable.getBoundingClientRect(),
            });
            // view.dispatch(view.state.tr.setMeta(plugin, meta));
          } else {
            callbacks.selectionChangedOnTable(undefined);
          }
        }
        if (tableEditingKey.getState(view.state) != null) return view.state.selection
      },

      handleClickOn(view, pos, node, nodePos, event, direct) {
        if (event.button === 2 && node.type.name === 'table_cell') {
          const domCell = view.domAtPos(nodePos + 1).node;
          setTimeout(() => {
            callbacks.contextMenuOnCell(domCell.getBoundingClientRect());
          }, 1);
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return true;
        }
        return false;
      },

      handleTripleClick,

      handleKeyDown,

      handlePaste
    },

    appendTransaction(_, oldState, state) {
      return normalizeSelection(state, fixTables(state, oldState), allowTableNodeSelection)
    }
  })
}

export {fixTables, handlePaste, fixTablesKey}
export {closestCell, cellAround, isInTable, isHeadInsideTable, selectionCell, moveCellForward, inSameTable, findCell, colCount, nextCell, setAttr, pointsAtCell, removeColSpan, addColSpan, columnIsHeader} from "./util";
export {tableNodes, tableNodeTypes} from "./schema"
export {CellSelection} from "./cellselection"
export {TableMap} from "./tablemap"
export {tableEditingKey};
export * from "./commands"
export {columnResizing, key as columnResizingPluginKey} from "./columnresizing"
export {updateColumns as updateColumnsOnResize, TableView} from "./tableview"
export {pastedCells as __pastedCells, insertCells as __insertCells, clipCells as __clipCells} from "./copypaste"
