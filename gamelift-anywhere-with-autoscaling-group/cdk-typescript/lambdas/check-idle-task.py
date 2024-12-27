import boto3
import os
from datetime import datetime
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def extract_task_id(task_arn):
    """Extract the task ID from a task ARN"""
    return task_arn.split('/')[-1]

def get_protected_tasks(ecs_client, cluster_name):
    """Get all tasks with scale-in protection enabled"""
    try:
        response = ecs_client.list_tasks(
            cluster=cluster_name,
            desiredStatus='RUNNING'
        )
        
        if not response['taskArns']:
            logger.info(f"No running tasks found in cluster {cluster_name}")
            return []

        tasks = ecs_client.describe_tasks(
            cluster=cluster_name,
            tasks=response['taskArns']
        )['tasks']

        protected_tasks = []
        
        # Check protection status in batches of 10
        for i in range(0, len(tasks), 10):
            batch_tasks = tasks[i:i + 10]
            task_arns = [task['taskArn'] for task in batch_tasks]
            
            try:
                protection_response = ecs_client.get_task_protection(
                    cluster=cluster_name,
                    tasks=task_arns
                )

                for protected_task in protection_response['protectedTasks']:
                    if protected_task['protectionEnabled']:
                        protected_task_id = extract_task_id(protected_task['taskArn'])
                        task_details = next(
                            (task for task in batch_tasks 
                            if extract_task_id(task['taskArn']) == protected_task_id),
                            None
                        )
                        if task_details:
                            protected_tasks.append({
                                'taskArn': task_details['taskArn'],
                                'taskId': protected_task_id
                            })
                            
            except Exception as e:
                logger.error(f"Error getting protection status: {str(e)}")
                continue

        return protected_tasks
        
    except Exception as e:
        logger.error(f"Error getting protected tasks: {str(e)}")
        return []

def check_game_sessions_for_compute(gamelift_client, fleet_id, location, compute_id):
    """Check if a compute has any active game sessions"""
    try:
        response = gamelift_client.describe_game_sessions(
            FleetId=fleet_id,
            Location=location,
            StatusFilter='ACTIVE'
        )
        
        active_sessions = response['GameSessions']
        
        # Filter sessions for this compute by checking GameProperties
        compute_sessions = [
            session for session in active_sessions
            if any(
                prop['Key'] == 'computeId' and prop['Value'] == compute_id
                for prop in session.get('GameProperties', [])
            )
        ]
        
        if compute_sessions:
            logger.info(f"Found {len(compute_sessions)} active game sessions for compute {compute_id}")
            return True
        else:
            logger.info(f"No active game sessions found for compute {compute_id}")
            return False
            
    except Exception as e:
        logger.error(f"Error checking game sessions for compute {compute_id}: {str(e)}")
        return False

def disable_task_protection(ecs_client, cluster_name, task_arn):
    """Disable protection for a task"""
    try:
        response = ecs_client.update_task_protection(
            cluster=cluster_name,
            tasks=[task_arn],
            protectionEnabled=False
        )
        return True
    except Exception as e:
        logger.error(f"Error disabling protection for task {task_arn}: {str(e)}")
        return False

def lambda_handler(event, context):
    # Initialize AWS clients
    ecs_client = boto3.client('ecs')
    gamelift_client = boto3.client('gamelift')
    
    # Get environment variables
    cluster_name = os.environ['ECS_CLUSTER_NAME']
    fleet_id = os.environ['GAMELIFT_FLEET_ID']
    location = os.environ['GAMELIFT_LOCATION']
    
    logger.info(f"Starting check for cluster: {cluster_name} and fleet: {fleet_id}")
    
    try:
        # Get protected tasks
        protected_tasks = get_protected_tasks(ecs_client, cluster_name)
        logger.info(f"Found {len(protected_tasks)} protected tasks")
        
        tasks_updated = 0
        tasks_checked = 0
        
        # Check each protected task
        for task in protected_tasks:
            tasks_checked += 1
            task_arn = task['taskArn']
            task_id = task['taskId']
            
            # Check if compute has active game sessions using computeId in GameProperties
            has_active_sessions = check_game_sessions_for_compute(
                gamelift_client, 
                fleet_id,
                location,
                task_id
            )
            
            if not has_active_sessions:
                logger.info(f"Task/Compute {task_id} has no active sessions - disabling protection")
                if disable_task_protection(ecs_client, cluster_name, task_arn):
                    tasks_updated += 1
            else:
                logger.info(f"Task/Compute {task_id} has active game sessions - keeping protection")
        
        summary_message = (
            f"Execution Summary:\n"
            f"- Protected Tasks Checked: {tasks_checked}\n"
            f"- Tasks Updated (Protection Disabled): {tasks_updated}"
        )
        logger.info(summary_message)
        
        return {
            'statusCode': 200,
            'body': summary_message
        }
        
    except Exception as e:
        error_message = f"Error in lambda execution: {str(e)}"
        logger.error(error_message)
        return {
            'statusCode': 500,
            'body': error_message
        }
