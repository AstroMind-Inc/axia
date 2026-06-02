"""
Background task manager for handling long-running workflows independent of HTTP connections.
"""

import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class BackgroundTaskManager:
    """
    Manages background tasks with in-memory queue communication.
    Ensures workflows complete even if client disconnects.
    """
    
    def __init__(self, cleanup_delay_seconds: int = 300):
        """
        Initialize the background task manager.
        
        Args:
            cleanup_delay_seconds: How long to keep completed tasks in memory (default: 5 minutes)
        """
        # Active workflow queues: request_id -> asyncio.Queue
        self.active_workflows: Dict[str, asyncio.Queue] = {}
        
        # Workflow results cache: request_id -> result dict
        self.workflow_results: Dict[str, Any] = {}
        
        # Active background tasks: request_id -> asyncio.Task
        self.active_tasks: Dict[str, asyncio.Task] = {}
        
        # Cleanup configuration
        self.cleanup_delay = cleanup_delay_seconds
        
        logger.info(f"Initialized BackgroundTaskManager (cleanup delay: {cleanup_delay_seconds}s)")
    
    def create_workflow_queue(self, request_id: str) -> asyncio.Queue:
        """
        Create a new queue for a workflow.
        
        Args:
            request_id: Unique request identifier
            
        Returns:
            The created asyncio.Queue
        """
        queue = asyncio.Queue()
        self.active_workflows[request_id] = queue
        logger.info(f"Created workflow queue for request: {request_id}")
        return queue
    
    def get_workflow_queue(self, request_id: str) -> Optional[asyncio.Queue]:
        """
        Get the queue for a specific workflow.
        
        Args:
            request_id: Request identifier
            
        Returns:
            The queue, or None if not found
        """
        return self.active_workflows.get(request_id)
    
    def start_background_task(
        self,
        request_id: str,
        coroutine,
        cleanup_on_complete: bool = True
    ) -> asyncio.Task:
        """
        Start a background task that will run independently.
        
        Args:
            request_id: Request identifier
            coroutine: The coroutine to run
            cleanup_on_complete: Whether to schedule cleanup after completion
            
        Returns:
            The created asyncio.Task
        """
        task = asyncio.create_task(coroutine)
        self.active_tasks[request_id] = task
        
        # Add completion callback for cleanup
        if cleanup_on_complete:
            task.add_done_callback(
                lambda t: asyncio.create_task(self._schedule_cleanup(request_id))
            )
        
        logger.info(f"Started background task for request: {request_id}")
        return task
    
    async def _schedule_cleanup(self, request_id: str):
        """
        Schedule cleanup of workflow resources after a delay.
        
        Args:
            request_id: Request identifier
        """
        logger.info(f"Scheduling cleanup for request {request_id} in {self.cleanup_delay}s")
        await asyncio.sleep(self.cleanup_delay)
        await self.cleanup_workflow(request_id)
    
    async def cleanup_workflow(self, request_id: str):
        """
        Clean up resources for a completed workflow.
        
        Args:
            request_id: Request identifier
        """
        removed_items = []
        
        if request_id in self.active_workflows:
            # Close the queue by putting a sentinel value
            try:
                await self.active_workflows[request_id].put({"type": "cleanup"})
            except:
                pass
            del self.active_workflows[request_id]
            removed_items.append("queue")
        
        if request_id in self.workflow_results:
            del self.workflow_results[request_id]
            removed_items.append("results")
        
        if request_id in self.active_tasks:
            del self.active_tasks[request_id]
            removed_items.append("task")
        
        if removed_items:
            logger.info(f"Cleaned up workflow {request_id}: {', '.join(removed_items)}")
        else:
            logger.debug(f"No cleanup needed for request {request_id}")
    
    def store_workflow_result(self, request_id: str, result: Dict[str, Any]):
        """
        Store the final result of a workflow.
        
        Args:
            request_id: Request identifier
            result: Result dictionary
        """
        self.workflow_results[request_id] = result
        logger.info(f"Stored workflow result for request: {request_id}")
    
    def get_workflow_result(self, request_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve stored workflow result.
        
        Args:
            request_id: Request identifier
            
        Returns:
            Result dictionary, or None if not found
        """
        return self.workflow_results.get(request_id)
    
    def get_active_workflow_count(self) -> int:
        """Get the count of currently active workflows."""
        return len(self.active_workflows)
    
    def is_workflow_active(self, request_id: str) -> bool:
        """Check if a workflow is currently active."""
        return request_id in self.active_workflows
    
    async def put_update(self, request_id: str, update: Dict[str, Any], timeout: float = 1.0):
        """
        Put an update into the workflow queue (non-blocking).
        
        Args:
            request_id: Request identifier
            update: Update dictionary to send
            timeout: Maximum time to wait for queue space
        """
        queue = self.get_workflow_queue(request_id)
        if queue is None:
            logger.warning(f"Queue not found for request {request_id}, update dropped")
            return
        
        try:
            await asyncio.wait_for(queue.put(update), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f"Timeout putting update to queue for request {request_id}")
        except Exception as e:
            logger.error(f"Error putting update to queue for request {request_id}: {e}")
    
    async def get_update(self, request_id: str, timeout: float = 1.0) -> Optional[Dict[str, Any]]:
        """
        Get an update from the workflow queue (with timeout).
        
        Args:
            request_id: Request identifier
            timeout: Maximum time to wait for update
            
        Returns:
            Update dictionary, or None if timeout
        """
        queue = self.get_workflow_queue(request_id)
        if queue is None:
            logger.warning(f"Queue not found for request {request_id}")
            return None
        
        try:
            return await asyncio.wait_for(queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        except Exception as e:
            logger.error(f"Error getting update from queue for request {request_id}: {e}")
            return None


# Global singleton instance
_background_task_manager: Optional[BackgroundTaskManager] = None


def get_background_task_manager(cleanup_delay_seconds: int = 300) -> BackgroundTaskManager:
    """
    Get the singleton instance of BackgroundTaskManager.
    
    Args:
        cleanup_delay_seconds: Cleanup delay (only used on first call)
        
    Returns:
        BackgroundTaskManager instance
    """
    global _background_task_manager
    if _background_task_manager is None:
        _background_task_manager = BackgroundTaskManager(cleanup_delay_seconds)
    return _background_task_manager

