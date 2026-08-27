/**
 * completions-i18n-en.mjs — англійський переклад описів автодоповнення.
 *
 * `lilka-api.json` знімається з анотацій прошивки, які написані українською
 * (Лілка — проєкт української спільноти). Перекладати сам `lilka-api.json`
 * не можна: він генерується, і переклад згорів би при першому ж
 * перегенеруванні. Тому переклад лежить окремим, рукописним файлом і
 * підставляється в `gen-completions.mjs` за ключем `простір.ім'я`.
 *
 * Ключ — завжди повне ім'я з простором, навіть для методів класів
 * (`alertUI.draw`), хоча в самому автодоповненні їхня мітка (`label`) без
 * префікса: кілька класів (`alertUI`, `keyboardUI`, `progressUI`) мають
 * методи з однаковими короткими іменами (`draw`, `setMessage`) і РІЗНИМ
 * змістом, тож саму лише коротку назву як ключ використати не можна.
 *
 * Немає запису — немає перекладу: `check-completions.mts` про це попереджає,
 * а `code-editor.ts` в такому разі просто показує українську версію.
 */

export const INFO_EN = {
    'alertUI.addActivationButton': "Adds a button that activates the alert (e.g. 'a', 'b').",
    'alertUI.draw': 'Draws the dialog on screen.',
    'alertUI.getButton': 'Returns the button the user pressed.',
    'alertUI.isFinished': 'Checks whether the dialog is finished.',
    'alertUI.setMessage': 'Sets a new message for the dialog.',
    'alertUI.setTitle': 'Sets a new title for the dialog.',
    'alertUI.update': 'Updates the dialog state.',

    'audio.get_volume': 'Returns the current playback volume.',
    'audio.is_playing': 'Returns `true` if audio is currently playing.',
    'audio.pause': 'Pauses playback.',
    'audio.play': 'Starts playing an audio file.',
    'audio.resume': 'Resumes playback after a pause.',
    'audio.set_volume': 'Sets the playback volume.',
    'audio.stop': 'Stops audio playback.',

    'buzzer.play': 'Plays a tone at the given frequency.',
    'buzzer.play_melody': 'Plays a melody.',
    'buzzer.stop': 'Stops all sounds.',

    console: 'Console.',
    'console.print': 'Prints a value to the console (on hardware — the serial port).',

    'controller.get_state': "Returns a table with the controller's state.",

    'display.color565': 'Returns a 16-bit color value.',
    'display.draw_arc':
        'Draws the outline of an arc centered at (x, y), with outer radius r1, inner radius r2, ' +
        'start angle start_angle, end angle end_angle, and color color.',
    'display.draw_circle': 'Draws the outline of a circle centered at (x, y) with radius r and color color.',
    'display.draw_ellipse':
        'Draws the outline of an ellipse centered at (x, y) with radii rx and ry and color color.',
    'display.draw_image': 'Draws an image on the screen.',
    'display.draw_image_transformed': 'Draws an image on the screen with a transform applied.',
    'display.draw_line': 'Draws a line on the screen.',
    'display.draw_pixel': 'Draws a pixel on the screen.',
    'display.draw_rect': 'Draws the outline of a rectangle at (x, y), size (w, h), and color color.',
    'display.draw_triangle':
        'Draws the outline of a triangle with vertices (x1, y1), (x2, y2), (x3, y3) and color color.',
    'display.fill_arc':
        'Draws a filled arc centered at (x, y), with outer radius r1, inner radius r2, ' +
        'start angle start_angle, end angle end_angle, and color color.',
    'display.fill_circle': 'Draws a filled circle centered at (x, y) with radius r and color color.',
    'display.fill_ellipse': 'Draws a filled ellipse centered at (x, y) with radii rx and ry and color color.',
    'display.fill_rect': 'Draws a filled rectangle at (x, y), size (w, h), and color color.',
    'display.fill_screen': 'Fills the screen with the given color.',
    'display.fill_triangle':
        'Draws a filled triangle with vertices (x1, y1), (x2, y2), (x3, y3) and color color.',
    'display.print': 'Prints text to the screen.',
    'display.queue_draw': 'Forces the screen contents to update.',
    'display.set_cursor': 'Sets the cursor position.',
    'display.set_font': 'Sets the font used for text output.',
    'display.set_text_bound': 'Sets the text bounding box.',
    'display.set_text_color': 'Sets the text color.',
    'display.set_text_size': 'Sets the text scale.',
    'display.height': 'display height in pixels',
    'display.width': 'display width in pixels',

    'File.exists': 'Returns whether the file exists.',
    'File.read': 'Reads from the file.',
    'File.seek': "Moves the file's read position.",
    'File.size': 'Returns the file size.',
    'File.write': 'Writes to the file.',

    'fs.joinpath': 'Joins path segments together.',
    'fs.ls': 'Returns a table listing files and directories at the given path.',
    'fs.mkpath': 'Creates a directory at the given path.',
    'fs.open': 'Opens a file at the given path.',
    'fs.remove': 'Deletes a file or directory at the given path.',
    'fs.rename': 'Renames a file or directory.',

    geometry: 'Geometry functions.',
    'geometry.intersect_aabb': 'Returns true if rectangle (ax, ay, aw, ah) overlaps rectangle (bx, by, bw, bh).',
    'geometry.intersect_lines': 'Returns true if segments AB and CD intersect.',

    'keyboardUI.draw': 'Draws the dialog on screen.',
    'keyboardUI.getValue': 'Returns the value entered in the dialog.',
    'keyboardUI.isFinished': 'Checks whether the dialog is finished.',
    'keyboardUI.setMasked': "Sets whether the typed text is masked (e.g. for a password field).",
    'keyboardUI.setValue': "Sets the input field's value.",
    'keyboardUI.update': 'Updates the dialog state.',

    'lilka.fullscreen': 'Whether to run the app fullscreen (defaults to `true`).',
    'lilka.show_fps': 'Shows the frame rate on screen when set to `true`.',

    'math.abs': 'Returns the absolute value of `x`.',
    'math.acos': 'Returns the arccosine of `x`.',
    'math.asin': 'Returns the arcsine of `x`.',
    'math.atan': 'Returns the arctangent of `x`.',
    'math.atan2': 'Returns the arctangent of `y`/`x`.',
    'math.avg': 'Returns the average of all numbers in the table.',
    'math.ceil': 'Rounds `x` up.',
    'math.clamp': 'Clamps x to the range between min and max (inclusive).',
    'math.cos': 'Returns the cosine of angle `x` (in radians).',
    'math.deg': 'Converts angle `x` from radians to degrees.',
    'math.dist': 'Returns the distance between points (x1, y1) and (x2, y2).',
    'math.floor': 'Rounds `x` down.',
    'math.len': 'Returns the length of vector (x, y).',
    'math.lerp': 'Linear interpolation.',
    'math.log': 'Returns the logarithm of `x`.',
    'math.map': 'Maps a value from one range to another.',
    'math.max': 'Returns the largest value in the table.',
    'math.min': 'Returns the smallest value in the table.',
    'math.norm': 'Normalizes vector (x, y) to unit length.',
    'math.pow': 'Returns `x` raised to the power `exp`.',
    'math.rad': 'Converts angle `x` from degrees to radians.',
    'math.random': 'Returns a random number.',
    'math.rotate':
        'Returns vector (x, y) rotated by angle `angle` **clockwise** (assuming the Y axis points down, ' +
        'as is common in computer graphics).',
    'math.round': 'Rounds `x` to the nearest integer.',
    'math.sign': "Returns the sign of `x`: -1 if negative, 0 if zero, 1 if positive.",
    'math.sin': 'Returns the sine of angle `x` (in radians).',
    'math.sqrt': 'Returns the square root of `x`.',
    'math.sum': 'Returns the sum of all numbers in the table.',
    'math.tan': 'Returns the tangent of angle `x` (in radians).',
    'math.e': 'The number e',
    'math.pi': 'The number π',
    'math.tau': 'The number τ (2π)',

    'progressUI.draw': 'Draws the dialog on screen.',
    'progressUI.setMessage': 'Sets a new message for the progress dialog.',
    'progressUI.setProgress': 'Sets the current progress (0 to 100) of the progress bar.',

    'resources.flip_image_x': 'Flips an image horizontally.',
    'resources.flip_image_y': 'Flips an image vertically.',
    'resources.load_image':
        'Loads a BMP image and returns a table with the image id (and its size) that other functions expect.',
    'resources.read_file': 'Reads a file and returns its contents as text.',
    'resources.rotate_image': 'Rotates an image clockwise by a given number of degrees around its center.',
    'resources.write_file': 'Writes text to a file.',

    'sdcard.ls': 'Returns a table listing files and directories at the given path.',
    'sdcard.open': 'Opens a file at the given path.',
    'sdcard.remove': 'Deletes a file or directory at the given path.',
    'sdcard.rename': 'Renames a file or directory.',

    state: "Storage for the program's data.",
    'state.clear': 'Deletes the state file and sets `state` to `nil`.',
    'state.reset': 'Reloads the `state` table from disk.',
    'state.save': 'Manually saves the `state` table to disk.',
    'state.path': 'Path to the state file (read-only).',

    'Transform.get': 'Returns the transform matrix.',
    'Transform.inverse': 'Returns the inverse of the current transform.',
    'Transform.multiply': 'Multiplies the transform by another transform and returns the result, unchanged in place.',
    'Transform.rotate': 'Rotates the transform by a given angle and returns a new transform.',
    'Transform.scale': 'Scales the transform on both axes and returns a new transform.',
    'Transform.set': 'Sets the transform matrix.',
    'Transform.vtransform': 'Applies the transform to a point and returns the new coordinates.',
    'transforms.new': 'Creates a new affine transform.',

    'util.exit': 'Ends the program.',
    'util.free_ram': 'Returns the amount of free RAM.',
    'util.sleep': 'Delays script execution for the given number of seconds.',
    'util.total_ram': 'Returns the total amount of RAM.',
};
