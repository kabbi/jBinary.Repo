define(['jBinary'], function (jBinary) {
	return {
		'jBinary.littleEndian': true,
		'jBinary.mimeType': 'image/bmp',

		RGBTriple: {
			b: 'uint8',
			g: 'uint8',
			r: 'uint8'
		},

		RGBQuad: ['extend', 'RGBTriple', {
			a: 'uint8'
		}],

		Dimensions: {
			horz: 'uint32',
			vert: 'uint32'
		},

		PixelRow: jBinary.Template({
			palette: null,

			setParams: function (header) {
				var itemType;

				switch (header.bpp) {
					case 1:
					case 2:
					case 4:
						this.palette = header.palette;
						itemType = header.bpp;
						break;

					case 8:
						this.palette = header.palette;
						itemType = 'uint8';
						break;

					case 16:
						itemType = jBinary.Template({
							baseType: 'uint16',
							mask: header.mask,
							read: function () {
								var colorIndex = this.baseRead();
								return {
									b: (colorIndex & this.mask.b) << 3,
									g: (colorIndex & this.mask.g) >> 3,
									r: (colorIndex & this.mask.r) >> 8
								};
							}
						});
						break;

					case 24:
						itemType = 'RGBTriple';
						break;

					case 32:
						itemType = 'RGBQuad';
						break;

					default:
						throw new TypeError('Sorry, but ' + header.bpp + 'bpp images are not supported.');
				}

				this.baseType = ['array', itemType, header.size.horz];
				this.dataOffset = header.dataOffset;
			},

			read: function () {
				var colors = this.baseRead();
				if (this.palette !== null) {
					for (var i = 0, length = colors.length; i < length; i++) {
						colors[i] = this.palette[colors[i]];
					}
				}

				// padding new row's alignment to 4 bytes
				var offsetOverhead = (this.binary.tell() - this.dataOffset) % 4;
				if (offsetOverhead) {
					this.binary.skip(4 - offsetOverhead);
					this.binary._bitShift = 0;
				}

				return colors;
			}
		}),

		Image: ['object', {
			// bitmap "magic" signature
			_signature: ['const', ['string', 2], 'BM', true],
			// full file Dimensions
			fileSize: 'uint32',
			// reserved
			reserved: 'uint32',
			// offset of bitmap data
			dataOffset: 'uint32',
			// Dimensions of DIB header
			dibHeaderSize: 'uint32',
			// image dimensions
			size: 'Dimensions',
			// color planes count (equals 1)
			planesCount: 'uint16',
			// color depth (bits per pixel)
			bpp: 'uint16',
			// compression type
			compression: 'uint32',
			// Dimensions of bitmap data
			dataSize: 'uint32',
			// resolutions (pixels per meter)
			resolution: 'Dimensions',
			// total color count
			colorsCount: jBinary.Template({
				baseType: 'uint32',
				read: function (context) {
					return this.baseRead() || Math.pow(2, context.bpp); /* (1 << bpp) not applicable for 32bpp */
				}
			}),
			// count of colors that are required for displaying image
			importantColorsCount: jBinary.Template({
				baseType: 'uint32',
				read: function (context) {
					return this.baseRead() || context.baseType;
				}
			}),
			// color palette (mandatory for <=8bpp images)
			palette: ['if', function (context) { return context.bpp <= 8 }, ['array', ['extend', 'RGBTriple', {_padding: ['skip', 1]}], 'colorsCount']],
			// color masks (needed for 16bpp images)
			mask: {
				r: 'uint32',
				g: 'uint32',
				b: 'uint32'
			},
			pixelData: jBinary.Type({
				read: function (header) {
					if (header.compression !== 0 && header.compression !== 3) {
						return null;
					}

					return this.binary.seek(header.dataOffset, function () {
						var width = header.size.horz, height = header.size.vert;
						var data = new jDataView(4 * width * height);
						var PixelRow = this.getType(['PixelRow', header]);
						for (var y = height - 1; y > 0; y--) {
							data.seek(4 * y * width);
							var colors = this.read(PixelRow);
							for (var i = 0, length = colors.length; i < length; i++) {
								var color = colors[i];
								data.writeBytes([color.r, color.g, color.b, 'a' in color ? color.a : 255]);
							}
						}
						return data.getBytes(undefined, 0);
					});
				}
			}),
			_binary: function () { return this.binary }
		}, {
			toCanvas: function (canvas) {
				if (!this.pixelData) {
					throw new TypeError('Sorry, but RLE compressed images are not supported.');
				}

				var context = canvas.getContext('2d'),
					imgData = context.createImageData(this.size.horz, this.size.vert);

				if ('set' in imgData.data) {
					imgData.data.set(this.pixelData);
				} else {
					for (var i = 0, length = this.pixelData.length; i < length; i++) {
						imgData.data[i] = this.pixelData[i];
					}
				}

				canvas.width = imgData.width;
				canvas.height = imgData.height;

				// putting image data to given canvas context
				context.putImageData(imgData, 0, 0);
			},
			toImage: function (img) {
				img.width = this.size.horz;
				img.height = this.size.vert;
				img.src = this._binary.toURI();
			}
		}]
	};
});