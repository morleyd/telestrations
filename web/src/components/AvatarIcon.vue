<template>
  <div class="me-2">
    <AvatarCircle :avatar="user?.avatar" :color="user?.color" :name="user?.username" />
  </div>
</template>
<script>
export default {
  props: ["user"],
}
</script>
