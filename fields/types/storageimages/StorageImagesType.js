var _ = require('lodash');
var assign = require('object-assign');
var async = require('async');
var FieldType = require('../Type');
var keystone = require('../../../');
var util = require('util');
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

function truthy (value) {
	return value;
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
						.write(resizedFilePath, function(err) {
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
 * CloudinaryImages FieldType Constructor
 */
function storageimages (list, path, options) {
	this.storage = options.storage;
	storageimages.super_.call(this, list, path, options);

}
storageimages.properName = 'StorageImages';
util.inherits(storageimages, FieldType);

/**
 * Registers the field on the List's Mongoose Schema.
 */
storageimages.prototype.addToSchema = function (schema) {
	const mongoose = keystone.mongoose;
	this.paths = {};

	const ImageSchema = new mongoose.Schema({
		etag: String,
		bucket: String,
		mimetype: String,
		filename: String,
		url: String,
		width: Number,
		height: Number,
		sizes: mongoose.SchemaTypes.Mixed,
	});

	schema.add(this._path.addTo({}, [ImageSchema]));

	// this.removeImage = function (item, id, method, callback) {
	// 	var images = item.get(field.path);
	// 	if (typeof id !== 'number') {
	// 		for (var i = 0; i < images.length; i++) {
	// 			if (images[i].public_id === id) {
	// 				id = i;
	// 				break;
	// 			}
	// 		}
	// 	}
	// 	var img = images[id];
	// 	if (!img) return;
	// 	if (method === 'delete') {
	// 		cloudinary.uploader.destroy(img.public_id, function () {});
	// 	}
	// 	images.splice(id, 1);
	// 	if (callback) {
	// 		item.save((typeof callback !== 'function') ? callback : undefined);
	// 	}
	// };
	// this.underscoreMethod('remove', function (id, callback) {
	// 	field.removeImage(this, id, 'remove', callback);
	// });
	// this.underscoreMethod('delete', function (id, callback) {
	// 	field.removeImage(this, id, 'delete', callback);
	// });
	this.bindUnderscoreMethods();
};

// storageimages.prototype.addToSchema = function (schema) {
// 	var field = this;
//
// 	this.paths = {};
// 	// add field paths from the storage schema
// 	Object.keys(this.storage.schema).forEach(function (path) {
// 		console.log('storage schema', path, field.path)
// 		field.paths[path] = field.path + '.' + path;
// 	});
//
// 	var schemaPaths = this._path.addTo({}, this.storage.schema);
// 	console.log('schemaPaths', schemaPaths)
// 	schema.add(schemaPaths);
//
// 	this.bindUnderscoreMethods();
// };

/**
 * Formats the field value
 */
storageimages.prototype.format = function (item) {
	return _.map(item.get(this.path), function (img) {
		return img.src();
	}).join(', ');
};

/**
 * Gets the field's data from an Item, as used by the React components
 */
storageimages.prototype.getData = function (item) {
	var value = item.get(this.path);
	return Array.isArray(value) ? value : [];
};

/**
 * Validates that a value for this field has been provided in a data object
 *
 * Deprecated
 */
storageimages.prototype.inputIsValid = function (data) { // eslint-disable-line no-unused-vars
	// TODO - how should image field input be validated?
	return true;
};

/**
 * Updates the value for this field in the item from a data object
 */
storageimages.prototype.updateItem = function (item, data, files, callback) {
	if (typeof files === 'function') {
		callback = files;
		files = {};
	} else if (!files) {
		files = {};
	}

	var field = this;
	var values = this.getValueFromData(data);

	// Early exit path: reset value when falsy, or bail if no value was provided
	if (!values) {
		if (values !== undefined) {
			item.set(field.path, []);
		}
		return process.nextTick(callback);
	}

	// When the value exists, but isn't an array, turn it into one (this just
	// means a single field was submitted in the formdata)
	if (!Array.isArray(values)) {
		values = [values];
	}
	// Preprocess values to deserialise JSON, detect mappings to uploaded files
	// and flatten out arrays
	values = values.map(function (value) {
		// When the value is a string, it may be JSON serialised data.
		if (typeof value === 'string'
			&& value.charAt(0) === '{'
			&& value.charAt(value.length - 1) === '}'
		) {
			try {
				return JSON.parse(value);
			} catch (e) { /* value isn't JSON */ }
		}
		if (typeof value === 'string') {
			// detect file upload (field value must be a reference to a field in the
			// uploaded files object provided by multer)
			if (value.substr(0, 7) === 'upload:') {
				var uploadFieldPath = value.substr(7);
				return files[uploadFieldPath];
			}
			// detect a URL or Base64 Data
			else if (/^(data:[a-z\/]+;base64)|(https?\:\/\/)/.test(value)) {
				return { path: value };
			}
		}
		return value;
	});
	values = _.flatten(values);

	async.map(values, (value, next) => {
		if (typeof value === 'object' && 'etag' in value) {
			// Cloudinary Image data provided
			if (value.etag) {
				// Default the object with empty values
				var v = assign(getEmptyValue(), value);
				return next(null, v);
			} else {
				// public_id is falsy, remove the value
				return next();
			}
		} else if (typeof value === 'object' && value.path) {
			var sizes = field.options.sizes || [];
			sizes.unshift({ type: 'admin', width: null, height: 90 });
			sizes.unshift({ type: 'original' });

			Promise.all(sizes.map(async (size, i) => {
				const resizedImage = await resizeImage(value, size);
				return new Promise((resolve, reject) => {
					field.storage.uploadFile(resizedImage, (err, result) => !err ? resolve(Object.assign({}, result)) : reject(err));
				});
			})).then(result => {
				const parsedResult = parseImageParams(result);
				return next(null, parsedResult);
			});
		} else {
			// Nothing to do
			// TODO: We should really also support deleting images from cloudinary,
			// see the CloudinaryImageType field for reference
			return next();
		}
	}, function (err, result) {
		if (err) return callback(err);
		result = result.filter(truthy);
		item.set(field.path, result);
		return callback();
	});
};

module.exports = storageimages;
