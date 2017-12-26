module.exports = {
	Field: require('../StorageImagesField'),
	Filter: require('../StorageImagesFilter'),
	section: 'Miscellaneous',
	spec: {
		label: 'StorageImages',
		path: 'storageimages',
		paths: {
			action: 'storageimages_action',
			folder: 'storageimages.folder',
			order: 'storageimages_order',
			upload: 'storageimages_upload',
			uploads: 'storageimages_uploads',
		},
		value: [],
	},
};
