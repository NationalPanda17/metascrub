// Tag dictionaries for EXIF / GPS / IPTC. Names follow the EXIF 2.32 spec.

export const TAGS = {
  0x0100: 'ImageWidth', 0x0101: 'ImageLength', 0x0102: 'BitsPerSample', 0x0103: 'Compression',
  0x0106: 'PhotometricInterpretation', 0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model',
  0x0111: 'StripOffsets', 0x0112: 'Orientation', 0x0115: 'SamplesPerPixel', 0x0116: 'RowsPerStrip',
  0x0117: 'StripByteCounts', 0x011a: 'XResolution', 0x011b: 'YResolution', 0x011c: 'PlanarConfiguration',
  0x0128: 'ResolutionUnit', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x013c: 'HostComputer',
  0x013e: 'WhitePoint', 0x013f: 'PrimaryChromaticities', 0x0201: 'JPEGInterchangeFormat',
  0x0202: 'JPEGInterchangeFormatLength', 0x0211: 'YCbCrCoefficients', 0x0213: 'YCbCrPositioning',
  0x0214: 'ReferenceBlackWhite', 0x02bc: 'XMLPacket', 0x4746: 'Rating', 0x4749: 'RatingPercent',
  0x8298: 'Copyright', 0x83bb: 'IPTC-NAA', 0x8773: 'InterColorProfile',
  0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9d: 'XPAuthor', 0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject',
  0xc4a5: 'PrintImageMatching',
  // EXIF sub-IFD
  0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram', 0x8824: 'SpectralSensitivity',
  0x8827: 'ISOSpeedRatings', 0x8830: 'SensitivityType', 0x8832: 'RecommendedExposureIndex',
  0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
  0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9012: 'OffsetTimeDigitized',
  0x9101: 'ComponentsConfiguration', 0x9102: 'CompressedBitsPerPixel', 0x9201: 'ShutterSpeedValue',
  0x9202: 'ApertureValue', 0x9203: 'BrightnessValue', 0x9204: 'ExposureBiasValue', 0x9205: 'MaxApertureValue',
  0x9206: 'SubjectDistance', 0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash',
  0x920a: 'FocalLength', 0x9214: 'SubjectArea', 0x927c: 'MakerNote', 0x9286: 'UserComment',
  0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized',
  0x9400: 'Temperature', 0x9401: 'Humidity', 0x9402: 'Pressure', 0x9403: 'WaterDepth', 0x9404: 'Acceleration',
  0x9405: 'CameraElevationAngle', 0xa000: 'FlashpixVersion', 0xa001: 'ColorSpace',
  0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension', 0xa004: 'RelatedSoundFile',
  0xa20b: 'FlashEnergy', 0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution',
  0xa210: 'FocalPlaneResolutionUnit', 0xa214: 'SubjectLocation', 0xa215: 'ExposureIndex',
  0xa217: 'SensingMethod', 0xa300: 'FileSource', 0xa301: 'SceneType', 0xa302: 'CFAPattern',
  0xa401: 'CustomRendered', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio',
  0xa405: 'FocalLengthIn35mmFilm', 0xa406: 'SceneCaptureType', 0xa407: 'GainControl', 0xa408: 'Contrast',
  0xa409: 'Saturation', 0xa40a: 'Sharpness', 0xa40c: 'SubjectDistanceRange', 0xa420: 'ImageUniqueID',
  0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber', 0xa432: 'LensSpecification', 0xa433: 'LensMake',
  0xa434: 'LensModel', 0xa435: 'LensSerialNumber', 0xa460: 'CompositeImage', 0xa500: 'Gamma',
};

export const GPS_TAGS = {
  0x00: 'GPSVersionID', 0x01: 'GPSLatitudeRef', 0x02: 'GPSLatitude', 0x03: 'GPSLongitudeRef',
  0x04: 'GPSLongitude', 0x05: 'GPSAltitudeRef', 0x06: 'GPSAltitude', 0x07: 'GPSTimeStamp',
  0x08: 'GPSSatellites', 0x09: 'GPSStatus', 0x0a: 'GPSMeasureMode', 0x0b: 'GPSDOP', 0x0c: 'GPSSpeedRef',
  0x0d: 'GPSSpeed', 0x0e: 'GPSTrackRef', 0x0f: 'GPSTrack', 0x10: 'GPSImgDirectionRef',
  0x11: 'GPSImgDirection', 0x12: 'GPSMapDatum', 0x13: 'GPSDestLatitudeRef', 0x14: 'GPSDestLatitude',
  0x15: 'GPSDestLongitudeRef', 0x16: 'GPSDestLongitude', 0x17: 'GPSDestBearingRef', 0x18: 'GPSDestBearing',
  0x19: 'GPSDestDistanceRef', 0x1a: 'GPSDestDistance', 0x1b: 'GPSProcessingMethod',
  0x1c: 'GPSAreaInformation', 0x1d: 'GPSDateStamp', 0x1e: 'GPSDifferential', 0x1f: 'GPSHPositioningError',
};

export const INTEROP_TAGS = { 0x0001: 'InteroperabilityIndex', 0x0002: 'InteroperabilityVersion' };

export const ENUMS = {
  Orientation: { 1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored + rotated 180°', 5: 'Mirrored + rotated 90° CCW', 6: 'Rotated 90° CW', 7: 'Mirrored + rotated 90° CW', 8: 'Rotated 90° CCW' },
  ResolutionUnit: { 1: 'None', 2: 'inches', 3: 'cm' },
  ExposureProgram: { 0: 'Not defined', 1: 'Manual', 2: 'Normal program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape' },
  MeteringMode: { 0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot', 4: 'Multi-spot', 5: 'Pattern', 6: 'Partial', 255: 'Other' },
  ColorSpace: { 1: 'sRGB', 0xffff: 'Uncalibrated' },
  WhiteBalance: { 0: 'Auto', 1: 'Manual' },
  ExposureMode: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' },
  SceneCaptureType: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' },
  SensingMethod: { 1: 'Not defined', 2: 'One-chip color area', 3: 'Two-chip color area', 4: 'Three-chip color area', 5: 'Color sequential area', 7: 'Trilinear', 8: 'Color sequential linear' },
  YCbCrPositioning: { 1: 'Centered', 2: 'Co-sited' },
  Compression: { 1: 'Uncompressed', 6: 'JPEG (thumbnail)', 7: 'JPEG', 5: 'LZW', 8: 'Deflate' },
  CompositeImage: { 0: 'Unknown', 1: 'Not composite', 2: 'Composite (e.g. HDR/panorama)', 3: 'Composite, captured while shooting' },
};

export const IPTC_TAGS = {
  5: 'ObjectName', 7: 'EditStatus', 10: 'Urgency', 15: 'Category', 20: 'SupplementalCategories',
  25: 'Keywords', 40: 'SpecialInstructions', 55: 'DateCreated', 60: 'TimeCreated', 62: 'DigitalCreationDate',
  63: 'DigitalCreationTime', 65: 'OriginatingProgram', 70: 'ProgramVersion', 80: 'By-line', 85: 'By-lineTitle',
  90: 'City', 92: 'Sub-location', 95: 'Province-State', 100: 'Country-PrimaryLocationCode',
  101: 'Country-PrimaryLocationName', 103: 'OriginalTransmissionReference', 105: 'Headline', 110: 'Credit',
  115: 'Source', 116: 'CopyrightNotice', 118: 'Contact', 120: 'Caption-Abstract', 122: 'Writer-Editor',
};
