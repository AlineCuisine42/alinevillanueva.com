// HEIC Support for iPhone Photo Uploads
// Add this to your site to enable iPhone photo uploads

(function() {
  // Wait for the page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHEICSupport);
  } else {
    initHEICSupport();
  }
  
  function initHEICSupport() {
    // Check if heic2any is available
    if (typeof heic2any === 'undefined') {
      console.warn('heic2any library not loaded');
      return;
    }
    
    // Override the original handleImageUpload function
    var originalHandleImageUpload = window.handleImageUpload;
    
    window.handleImageUpload = function(input, previewId, dataId) {
      var file = input.files[0];
      if (!file) return;
      
      // Check if it's a HEIC file
      var isHEIC = file.type === 'image/heic' || 
                   file.type === 'image/heif' || 
                   file.name.toLowerCase().endsWith('.heic') ||
                   file.name.toLowerCase().endsWith('.heif');
      
      if (isHEIC) {
        // Convert HEIC to JPEG
        heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.9
        }).then(function(convertedBlob) {
          var reader = new FileReader();
          reader.onload = function(e) {
            compressImage(e.target.result, function(compressed) {
              document.getElementById(dataId).value = compressed;
              var preview = document.getElementById(previewId);
              var previewImg = document.getElementById(previewId + '-img');
              previewImg.src = compressed;
              preview.style.display = 'block';
            });
          };
          reader.readAsDataURL(convertedBlob);
        }).catch(function(err) {
          console.error('HEIC conversion failed:', err);
          alert('Could not process iPhone photo. Please try a different photo.');
          input.value = '';
        });
      } else {
        // Call original function for non-HEIC files
        if (originalHandleImageUpload) {
          originalHandleImageUpload(input, previewId, dataId);
        }
      }
    };
  }
})();
