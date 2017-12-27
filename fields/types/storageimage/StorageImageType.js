var FieldType = require('../Type');
var keystone = require('../../../');
var util = require('util');
var utils = require('keystone-utils');
var Jimp = require('jimp');
var sizeOf = require('image-size');

function getEmptyValue () {
	return {
		etag: '',
		bucket: '',
		mimetype: 'image/png',
		filename: '',
		url: '',
		width: 0,
		height: 0,
		sizes: [],
	};
}

function getBucketUrl (bucket, url) {
	const urlSlicePosition = url.indexOf('://') + 3;
	return url.indexOf(bucket) === -1 ? [url.slice(0, urlSlicePosition), bucket + '.', url.slice(urlSlicePosition)].join('') : url;
}

/**
 * Resize the images
 */
var resizeImage = function (file, size) {
	return new Promise(function (resolve, reject) {
		const formattedSize = [];

		if (size.type !== 'original') {
			formattedSize.push((size.width && size.width !== 'auto') ? size.width : Jimp.AUTO);
			formattedSize.push((size.height && size.height !== 'auto') ? size.height : Jimp.AUTO);
		}

		if (formattedSize.length > 0) {
			const formattedFileName = file.name.replace(/\.[^/.]+$/, '');
			const resizedFileName = formattedFileName + '-' + formattedSize.join('x') + '.' + file.extension;
			const resizedFilePath = '/tmp/' + resizedFileName;

			Jimp.read(file.path, function (err, image) {
				if (!err && image) {
					image.resize(...formattedSize)
						.write(resizedFilePath, function() {
							const imageSize = sizeOf(resizedFilePath);
							file.path = resizedFilePath;
							file.name = resizedFileName;

							resolve(Object.assign({}, file, imageSize, { type: size.type }));
						});
				} else {
					reject(err)
				}
			}).catch(function (err) {
				reject(err)
			});
		} else {
			const imageSize = sizeOf(file.path);
			resolve(Object.assign({}, file, imageSize, { type: size.type }));
		}
	});
};

var parseImageParams = function (images) {
	const originalImage = images.find(i => i.type === 'original');
	const sizes = images.filter(i => i.type !== 'original');
	const parsedSizes = {};

	sizes.map(s => {
		parsedSizes[s.type] = {
			etag: s.etag.replace(/['"]+/g, ''),
			filename: s.filename,
			url: getBucketUrl(s.bucket, s.url),
			width: s.width,
			height: s.height,
		};
	});

	return {
		etag: originalImage.etag.replace(/['"]+/g, ''),
		bucket: originalImage.bucket,
		mimetype: originalImage.mimetype,
		filename: originalImage.filename,
		url: getBucketUrl(originalImage.bucket, originalImage.url),
		width: originalImage.width,
		height: originalImage.height,
		sizes: parsedSizes,
	};
};

/**
 * CloudinaryImage FieldType Constructor
 * @extends Field
 * @api public
 */
function storageimage (list, path, options) {
	this.storage = options.storage;
	storageimage.super_.call(this, list, path, options);
}
storageimage.properName = 'StorageImage';
util.inherits(storageimage, FieldType);


/**
 * Registers the field on the List's Mongoose Schema.
 */
storageimage.prototype.addToSchema = function (schema) {
	var mongoose = keystone.mongoose;

	var schemaPaths = this._path.addTo({}, {
		etag: String,
		bucket: String,
		mimetype: String,
		filename: String,
		url: String,
		width: Number,
		height: Number,
		sizes: mongoose.SchemaTypes.Mixed,
	});

	schema.add(schemaPaths);
	this.bindUnderscoreMethods();
};

/**
 * Always assumes the input is valid
 *
 * Deprecated
 */
storageimage.prototype.inputIsValid = function () {
	return true;
};

/**
 * Updates the value for this field in the item from a data object
 * TODO: It is not possible to remove an existing value and upload a new image
 * in the same action, this should be supported
 */
storageimage.prototype.updateItem = function (item, data, files, callback) {
	// Process arguments
	if (typeof files === 'function') {
		callback = files;
		files = {};
	}
	if (!files) {
		files = {};
	}

	var field = this;

	// Prepare values
	var value = this.getValueFromData(data);
	var uploadedFile;

	// Providing the string "remove" removes the file and resets the field
	// if (value === 'remove') {
		// cloudinary.uploader.destroy(item.get(field.paths.public_id), function (result) {
		// 	if (result.error) {
		// 		callback(result.error);
		// 	} else {
		// 		item.set(field.path, getEmptyValue());
		// 		callback();
		// 	}
		// });
		// return;
	// }

	// Find an uploaded file in the files argument, either referenced in the
	// data argument or named with the field path / field_upload path + suffix
	// Base64 data and remote URLs are also accepted as images to upload
	if (typeof value === 'string' && value.substr(0, 7) === 'upload:') {
		uploadedFile = files[value.substr(7)];
	} else if (typeof value === 'string' && /^(data:[a-z\/]+;base64)|(https?\:\/\/)/.test(value)) {
		uploadedFile = { path: value };
	} else {
		uploadedFile = this.getValueFromData(files) || this.getValueFromData(files, '_upload');
	}

	// Ensure a valid file was uploaded, else null out the value
	if (uploadedFile && !uploadedFile.path) {
		uploadedFile = undefined;
	}

	// If we have a file to upload, we do that and stop here
	if (uploadedFile) {
		var sizes = field.options.sizes || [];
		sizes.unshift({ type: 'admin', width: null, height: 90 });
		sizes.unshift({ type: 'original' });

		Promise.all(sizes.map(async (size, i) => {
			const resizedImage = await resizeImage(uploadedFile, size);
			return new Promise((resolve, reject) => {
				field.storage.uploadFile(resizedImage, (err, result) => !err ? resolve(Object.assign({}, result)) : reject(err));
			});
		})).then(result => {
			const parsedResult = parseImageParams(result);
			item.set(field.path, parsedResult);
			return callback();
		}).catch(error => {
			return callback(error);
		});

		return;
	}

	// Empty / null values reset the field
	if (value === null || value === '' || (typeof value === 'object' && !Object.keys(value).length)) {
		value = getEmptyValue();
	}

	// If there is a valid value at this point, set it on the field
	if (typeof value === 'object') {
		item.set(this.path, value);
	}
	utils.defer(callback);
};

/* Export Field Type */
module.exports = storageimage;
