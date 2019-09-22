const Buffer = require("buffer").Buffer;
const AWS = require("aws-sdk");
AWS.config.update({region: "us-west-2"});

const STREAM_NAME = "test-log-stream";
const MAX_ITEM_SIZE = 1048576;
// const ENCODED_64_COST = 4 / 3;
const MAX_KINESIS_BATCH_SIZE = 250;
const ALLOW_RETRY_ERROR_CODES = [
	"ProvisionedThroughputExceededException",
	"ThrottlingException",
	"ServiceUnavailable",
	"ProvisionedThroughputExceededException",
	"RequestExpired",
];

function create_kinesis_event(raw_event) {
	return {Data: Buffer.from(JSON.stringify(raw_event)).toString("base64"), PartitionKey: "1"};
}

function put_records(records, streamName) {
	return new Promise(function(resolve, reject) {
		let kinesis = new AWS.Kinesis();
		let params = {
		  Records: records,
		  StreamName: streamName
		};
		kinesis.putRecords(params, function(err, data) {
		  if (err) {
				console.log(err, err.stack);
				reject(err);
		  }
		  else {
		  		// console.log(data);
				resolve(data);
		  }
		});
	});
}

function parse_kinesis_problematic_records(records) {
	let problamatic_records = records;
	let retryItems = [];
	let badItems = [];
	problamatic_records.forEach(function (record, index) {
		if (record.hasOwnProperty("ErrorCode")) {
			if (record["ErrorCode"] in ALLOW_RETRY_ERROR_CODES) {
				retryItems.push(index);
			} else {
				badItems.push(index);
			}
		}
	});
	return [retryItems, badItems];
}

exports.sendLogs = async function(records) {
	let response_records = [];
	let records_to_write = [];
	let retry_items_len = 0;
	let raw_events = records.map(event => create_kinesis_event(event));

	while (raw_events.length > 0) {
		let event = raw_events.pop();
		let event_size = JSON.stringify(event["Data"]).length;

		if (event_size > MAX_ITEM_SIZE) {
			// event is too big
			continue;
		}
		records_to_write.push(event);
		if (raw_events.length === 0 || records_to_write.length === MAX_KINESIS_BATCH_SIZE) {
			// let number_of_records = records_to_write.length;
			try {
				let response = await put_records(records_to_write, STREAM_NAME);

				// todo: the things below

				// deal with retries/ bads
				let problematicRecords = parse_kinesis_problematic_records(response["Records"]);
				let retryItems = problematicRecords[0];
				// let badItems = problematicRecords[1];

				// add retry count to `retry_items_len`
				retry_items_len += retryItems.length;

				// add retires back to raw_events
				for (let record in retryItems) {
					raw_events.push(records_to_write[record]);
				}

				// log iteration
				// log? badItems

				response_records = response_records.concat(response["Records"]);
			} catch (error) {
				console.log(error);
			}
			records_to_write = [];
		}
	}
	// log end
	console.log({"records": response_records.length, "retried_items_count": retry_items_len});
	return {"records": response_records, "retried_items_count": retry_items_len};
};