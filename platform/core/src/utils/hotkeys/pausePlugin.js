/**
 * adds a pause and unpause method to Mousetrap
 * this allows you to enable or disable keyboard shortcuts
 * without having to reset Mousetrap and rebind everything
 *
 * https://github.com/ccampbell/mousetrap/blob/master/plugins/pause/mousetrap-pause.js
 */
export default function pausePlugin(Mousetrap) {
  var _originalStopCallback = Mousetrap.prototype.stopCallback;

  Mousetrap.prototype.stopCallback = function (e, element, combo) {
    var self = this;

    if (self.paused) {
      return true;
    }

    var originalResult = _originalStopCallback.call(self, e, element, combo);
    
    // CUSTOM DEBUG LOGGING
    if (e && e.key === 'f') {
      console.log('Mousetrap stopCallback for f:', {
        element,
        tagName: element?.tagName,
        isContentEditable: element?.isContentEditable,
        originalResult
      });
    }

    // ACTECAL OVERRIDE: If the element is within a contenteditable or has our editor class, stop it!
    if (element && (element.isContentEditable || (element.closest && element.closest('[contenteditable="true"]')) || (element.closest && element.closest('.editor-input')))) {
      if (e.key === 'f') console.log('ACTECAL OVERRIDE: Stopping mousetrap for f in editor');
      return true;
    }

    return originalResult;
  };

  Mousetrap.prototype.pause = function () {
    var self = this;
    self.paused = true;
  };

  Mousetrap.prototype.unpause = function () {
    var self = this;
    self.paused = false;
  };

  Mousetrap.init();
}
