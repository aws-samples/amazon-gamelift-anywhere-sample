import boto3
from botocore.exceptions import ClientError
import time
import os
import logging
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor, as_completed
from boto3.dynamodb.types import TypeSerializer
import math
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def upload_to_dynamodb_batch(items, table_name):
    """
    Upload items to DynamoDB table in batches using parallel processing
    """
    dynamodb = boto3.client('dynamodb')
    serializer = TypeSerializer()
    
    # DynamoDB BatchWriteItem can process up to 25 items per batch
    BATCH_SIZE = 25
    
    def serialize_item(item):
        # Convert Python dict to DynamoDB format
        return {k: serializer.serialize(v) for k, v in item.items()}
    
    def process_batch(batch_items):
        try:
            request_items = {
                table_name: [
                    {'PutRequest': {'Item': serialize_item(item)}}
                    for item in batch_items
                ]
            }
            
            response = dynamodb.batch_write_item(RequestItems=request_items)
            
            # Handle unprocessed items with exponential backoff
            unprocessed = response.get('UnprocessedItems', {})
            retry_count = 0
            max_retries = 3
            
            while unprocessed and retry_count < max_retries:
                retry_count += 1
                # Exponential backoff
                time.sleep(2 ** retry_count)
                retry_response = dynamodb.batch_write_item(RequestItems=unprocessed)
                unprocessed = retry_response.get('UnprocessedItems', {})
                
            if unprocessed:
                print(f"Warning: Some items were not processed after {max_retries} retries")
                
        except Exception as e:
            print(f"Error processing batch: {str(e)}")
            raise
    
    # Split items into batches
    batches = [items[i:i + BATCH_SIZE] for i in range(0, len(items), BATCH_SIZE)]
    
    # Calculate optimal number of threads
    # Use min of (number of CPU cores * 2) or (number of batches)
    max_workers = min(math.ceil(len(batches)), (os.cpu_count() or 1) * 2)
    logger.info(f"batches: {len(batches)}, os cpu: {os.cpu_count()}, max_workers:  {max_workers}")
    
    # Process batches in parallel
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(process_batch, batch) for batch in batches]
        
        # Wait for all futures to complete and handle any exceptions
        for future in futures:
            try:
                future.result()
            except Exception as e:
                print(f"Batch processing failed: {str(e)}")
                raise

my_config = Config(region_name = 'us-west-2')

ga_client = boto3.client('globalaccelerator', config=my_config)

def list_custom_routing_port_mappings(accelerator_arn, batch_size=100):
    paginator = ga_client.get_paginator('list_custom_routing_port_mappings')
    batch = []
    for page in paginator.paginate(AcceleratorArn=accelerator_arn):
        for port_mapping in page['PortMappings']:
            batch.append(port_mapping)
            if len(batch) >= batch_size:
                yield batch
                batch = []
    if batch:  # Yield any remaining items
        yield batch

def lambda_handler(event, context):
    logger.debug(event)
    globalaccelerator_arn = event['globalaccelerator_arn']

    try:
      start_time = time.time()
      total_uploaded = 0

      total_uploaded = 0

      # Use dynamodb table 
      table_name = os.environ.get('PORT_MAPPING_TABLE_NAME')
      if not table_name:
          raise ValueError("DynamoDB table name not provided in environment variables")

      for batch in list_custom_routing_port_mappings(globalaccelerator_arn):
          # Transform the batch items to include necessary DynamoDB attributes
          dynamo_batch = [{
            'AcceleratorPort': item.get('AcceleratorPort'),
            'EndpointGroupArn': item.get('EndpointGroupArn'),
            'EndpointId': item.get('EndpointId'),
            'DestinationIpAddress': item.get('DestinationSocketAddress')['IpAddress'],
            'DestinationPort': item.get('DestinationSocketAddress')['Port'],
            'Protocols': item.get('Protocols'),
            'DestinationTrafficState': item.get('DestinationTrafficState'),
          } for item in batch]
        
          try:
            upload_to_dynamodb_batch(dynamo_batch, table_name)
            total_uploaded += len(dynamo_batch)
          except Exception as e:
            print(f"Error uploading batch to DynamoDB: {str(e)}")
            raise

      logger.debug(f"total_uploaded: {total_uploaded}")

      end_time = time.time()

      logger.debug(f"Total of uploaded items to DDB: {total_uploaded}")
      logger.debug(f"Time taken: {end_time - start_time:.2f} seconds")
      
    except ClientError as err:
      logger.debug(err)
      return err

